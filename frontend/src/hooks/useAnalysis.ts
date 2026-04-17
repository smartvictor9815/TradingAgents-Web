import { useState, useEffect, useCallback, useRef } from 'react';
import {
  startAnalysis,
  cancelTask,
  getTaskStatus,
  getStoredHistory,
  AnalysisRequest,
} from '../api/client';
import { upsertFailedSnapshot } from '../utils/analysisReportsStorage';
import { useSSE } from './useSSE';

/** Set by reset; next Analysis page mount will not auto-resume the latest local task. */
export const SKIP_ANALYSIS_RESUME_ONCE_KEY = 'tradingagents-skip-analysis-resume-once';

export type ResumeFromStorageResult =
  | { ok: true; ticker: string; analysisDate: string }
  | { ok: false };

interface Agent {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  content?: string;
  type?: 'Tool' | 'Data';
}

interface Team {
  name: string;
  agents: Agent[];
}

interface AnalysisState {
  isAnalyzing: boolean;
  hasStarted: boolean;
  taskId: string | null;
  teams: Team[];
  messages: Array<{
    time: string;
    type: string;
    content: string;
  }>;
  finalDecision: {
    decision: string;
    signal: string;
    reasoning?: string;
    dimensionConfidence?: Record<string, number>;
  } | null;
  error: string | null;
  currentReport: string;
  reportCount: string;
  stats: {
    llmCalls: number;
    toolCalls: number;
    tokensIn: number;
    tokensOut: number;
    startTime: number | null;
    endTime: number | null;
  };
}

const ANALYST_LABELS: Record<string, string> = {
  market: 'Market Analyst',
  social: 'Social Analyst',
  news: 'News Analyst',
  fundamentals: 'Fundamentals Analyst',
};

function buildInitialTeams(request: AnalysisRequest): Team[] {
  const selectedAnalysts =
    request.runtime?.selected_analysts ||
    ['market', 'social', 'news', 'fundamentals'];

  return [
    {
      name: 'Analyst Team',
      agents: selectedAnalysts.map((analyst) => ({
        name: ANALYST_LABELS[analyst] || analyst,
        status: 'pending' as const,
      })),
    },
    {
      name: 'Research Team',
      agents: [
        { name: 'Bull Researcher', status: 'pending' },
        { name: 'Bear Researcher', status: 'pending' },
        { name: 'Research Manager', status: 'pending' },
      ],
    },
    {
      name: 'Trading Team',
      agents: [
        { name: 'Trader', status: 'pending' },
      ],
    },
    {
      name: 'Risk Management',
      agents: [
        { name: 'Aggressive Analyst', status: 'pending' },
        { name: 'Neutral Analyst', status: 'pending' },
        { name: 'Conservative Analyst', status: 'pending' },
      ],
    },
  ];
}

function teamsWithUniformAgentStatus(teams: Team[], status: Agent['status']): Team[] {
  return teams.map((team) => ({
    ...team,
    agents: team.agents.map((agent) => ({ ...agent, status })),
  }));
}

function updateAgentStatus(teams: Team[], agentName: string, status: Agent['status']): Team[] {
  let found = false;

  const nextTeams = teams.map((team) => ({
    ...team,
    agents: team.agents.map((agent) => {
      if (agent.name === agentName) {
        found = true;
        return { ...agent, status };
      }
      return agent;
    }),
  }));

  if (!found) {
    return nextTeams.map((team) => {
      if (team.name !== 'System') return team;
      return {
        ...team,
        agents: [...team.agents, { name: agentName, status }],
      };
    });
  }

  return nextTeams;
}

/**
 * Sync teams state from backend agent_status (CLI-consistent).
 * This ensures frontend state matches the backend's authoritative state.
 */
function syncTeamsFromAgentStatus(
  teams: Team[],
  agentStatus: Record<string, string>
): Team[] {
  if (!agentStatus || Object.keys(agentStatus).length === 0) {
    return teams;
  }

  return teams.map((team) => ({
    ...team,
    agents: team.agents.map((agent) => {
      const backendStatus = agentStatus[agent.name];
      if (backendStatus) {
        // Map backend status to frontend status
        let mappedStatus: Agent['status'] = 'pending';
        switch (backendStatus) {
          case 'pending':
            mappedStatus = 'pending';
            break;
          case 'in_progress':
            mappedStatus = 'running';
            break;
          case 'completed':
            mappedStatus = 'completed';
            break;
          case 'error':
            mappedStatus = 'error';
            break;
          default:
            mappedStatus = 'pending';
        }
        return { ...agent, status: mappedStatus };
      }
      return agent;
    }),
  }));
}

function normalizeMessages(rows: unknown): AnalysisState['messages'] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      return {
        time:
          typeof r.time === 'string' && r.time.trim()
            ? r.time
            : '',
        type:
          typeof r.type === 'string' && r.type.trim()
            ? r.type
            : 'System',
        content:
          typeof r.content === 'string' ? r.content : '',
      };
    })
    .filter((x): x is AnalysisState['messages'][number] => x !== null);
}

function extractMessagesFromStoredReport(raw: unknown): AnalysisState['messages'] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  return normalizeMessages(obj.messages);
}

function extractFinalDecisionFromStoredReport(
  raw: unknown,
): AnalysisState['finalDecision'] {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const candidate =
    (obj.final_decision && typeof obj.final_decision === 'object'
      ? obj.final_decision
      : obj.results && typeof obj.results === 'object'
        ? obj.results
        : null) as Record<string, unknown> | null;
  if (!candidate) return null;

  const decision =
    typeof candidate.decision === 'string' ? candidate.decision : '';
  const signal =
    typeof candidate.signal === 'string' ? candidate.signal : 'neutral';
  const dimensionConfidenceRaw =
    candidate.dimension_confidence ?? candidate.dimensionConfidence;
  const dimensionConfidence =
    dimensionConfidenceRaw && typeof dimensionConfidenceRaw === 'object'
      ? (dimensionConfidenceRaw as Record<string, number>)
      : undefined;
  if (!decision && !dimensionConfidence) return null;
  return { decision, signal, dimensionConfidence };
}

function normalizeStoredStatus(raw: unknown): 'running' | 'completed' | 'error' | 'cancelled' {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'running' || v === 'pending') return 'running';
  if (v === 'error' || v === 'failed') return 'error';
  if (v === 'cancelled' || v === 'canceled') return 'cancelled';
  return 'completed';
}

function toEpochSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  const ms = Date.parse(raw);
  if (!Number.isNaN(ms)) return ms / 1000;

  // Fallback parser for Python isoformat strings (often microseconds without timezone),
  // which can fail Date.parse() in some runtimes.
  const m = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([Zz])|([+-]\d{2}):?(\d{2}))?$/,
  );
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const fraction = (m[7] || '').slice(0, 3).padEnd(3, '0');
  const millis = Number(fraction || '0');

  const hasZulu = !!m[8];
  const offsetHour = m[9] ? Number(m[9]) : null;
  const offsetMinute = m[10] ? Number(m[10]) : 0;

  if (hasZulu || offsetHour !== null) {
    const utcMs = Date.UTC(year, month, day, hour, minute, second, millis);
    if (offsetHour === null) return utcMs / 1000;
    const sign = offsetHour >= 0 ? 1 : -1;
    const offsetTotalMs =
      sign * (Math.abs(offsetHour) * 60 + Math.abs(offsetMinute)) * 60 * 1000;
    return (utcMs - offsetTotalMs) / 1000;
  }

  return new Date(year, month, day, hour, minute, second, millis).getTime() / 1000;
}

export function useAnalysis() {
  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    isAnalyzing: false,
    hasStarted: false,
    taskId: null,
    teams: [],
    messages: [],
    finalDecision: null,
    error: null,
    currentReport: '',
    reportCount: '0/7',
    stats: {
      llmCalls: 0,
      toolCalls: 0,
      tokensIn: 0,
      tokensOut: 0,
      startTime: null,
      endTime: null,
    },
  });

  const seenEventIds = useRef<Set<string>>(new Set());

  // Only subscribe while analysis is running. After task_complete the stream closes; keeping
  // EventSource open makes the browser retry GET /api/task/{id}/stream and can surface 404
  // (Task not found) if the server restarted or if the tab confuses reconnect with a missing task.
  const sseUrl =
    analysisState.taskId && analysisState.isAnalyzing
      ? `/api/task/${analysisState.taskId}/stream`
      : null;

  useSSE(sseUrl, {
    onMessage: (event) => {
      try {
        const payload = JSON.parse(event.data);
        const msgId = payload.id;
        
        if (msgId && seenEventIds.current.has(msgId)) {
          return; // Duplicate
        }
        
        if (msgId) {
          seenEventIds.current.add(msgId);
        }
        
        handleSSEEvent(payload);
      } catch (e) {
        console.error('Error parsing SSE message:', e);
      }
    },
    onError: (error) => {
      console.error('SSE Error:', error);
      setAnalysisState((prev) => ({
        ...prev,
        error: 'Connection to analysis stream lost',
      }));
    },
  });

  const handleSSEEvent = useCallback((eventData: any) => {
    const { event, data } = eventData;

    switch (event) {
      case 'task_start':
        setAnalysisState((prev) => {
          // Use plan from backend if available, otherwise fallback to existing teams or empty
          const backendPlan = data.plan;
          let newTeams = prev.teams;

          if (backendPlan && Array.isArray(backendPlan)) {
            newTeams = backendPlan.map((team: any) => ({
              name: team.name,
              agents: team.agents.map((agentName: string) => ({
                name: agentName,
                status: 'pending' as const
              }))
            }));
          }

          // Sync with backend agent_status if available (CLI-consistent)
          if (data.agent_status) {
            newTeams = syncTeamsFromAgentStatus(newTeams, data.agent_status);
          }

          // Update report count from backend (CLI-consistent)
          const completedReports = data.completed_reports ?? 0;
          const totalReports = data.total_reports ?? 7;

          return {
            ...prev,
            isAnalyzing: true,
            teams: newTeams,
            reportCount: `${completedReports}/${totalReports}`,
            stats: {
              ...prev.stats,
              startTime:
                (typeof data.timestamp === 'number' && Number.isFinite(data.timestamp)
                  ? data.timestamp
                  : prev.stats.startTime ?? Date.now() / 1000),
              endTime: null,
            },
            messages: [
              ...prev.messages,
              {
                time: new Date().toLocaleTimeString(),
                type: 'System',
                content: `Analysis started for ${data.ticker} on ${data.date}`,
              },
            ],
          };
        });
        break;

      case 'agent_start':
        setAnalysisState((prev) => {
          const agentName = data.agent || 'Unknown Agent';
          const stats = data.stats || {};

          // Use backend agent_status for authoritative state (CLI-consistent)
          const newTeams = data.agent_status
            ? syncTeamsFromAgentStatus(prev.teams, data.agent_status)
            : updateAgentStatus(prev.teams, agentName, 'running');

          // Update report count from backend
          const completedReports = data.completed_reports ?? prev.reportCount.split('/')[0];
          const totalReports = data.total_reports ?? prev.reportCount.split('/')[1];

          return {
            ...prev,
            stats: {
              ...prev.stats,
              llmCalls: stats.llm_calls ?? prev.stats.llmCalls,
              toolCalls: stats.tool_calls ?? prev.stats.toolCalls,
              tokensIn: stats.tokens_in ?? prev.stats.tokensIn,
              tokensOut: stats.tokens_out ?? prev.stats.tokensOut,
            },
            teams: newTeams,
            reportCount: `${completedReports}/${totalReports}`,
            messages: [
              ...prev.messages,
              {
                time: new Date().toLocaleTimeString(),
                type: 'Agent',
                content: data.content || `Agent ${agentName} started`,
              },
            ],
          };
        });
        break;

      case 'agent_progress':
      case 'agent_thought':
        setAnalysisState((prev) => {
          const agentName = data.agent || 'Unknown Agent';
          const stats = data.stats || {};
          const eventType = event === 'agent_thought' ? 'Thought' : 'Agent';

          // Use backend agent_status for authoritative state (CLI-consistent)
          const newTeams = data.agent_status
            ? syncTeamsFromAgentStatus(prev.teams, data.agent_status)
            : updateAgentStatus(prev.teams, agentName, 'running');

          // Update report count from backend
          const completedReports = data.completed_reports ?? prev.reportCount.split('/')[0];
          const totalReports = data.total_reports ?? prev.reportCount.split('/')[1];

          return {
            ...prev,
            stats: {
              ...prev.stats,
              llmCalls: stats.llm_calls ?? prev.stats.llmCalls,
              toolCalls: stats.tool_calls ?? prev.stats.toolCalls,
              tokensIn: stats.tokens_in ?? prev.stats.tokensIn,
              tokensOut: stats.tokens_out ?? prev.stats.tokensOut,
            },
            teams: newTeams,
            reportCount: `${completedReports}/${totalReports}`,
            messages: [
              ...prev.messages,
              {
                time: new Date().toLocaleTimeString(),
                type: eventType,
                content: data.content || data.message || `Agent ${agentName} ${eventType.toLowerCase()}`,
              },
            ],
          };
        });
        break;

      case 'tool_call':
        setAnalysisState((prev) => {
          const toolName = data.tool || 'unknown_tool';
          const args = JSON.stringify(data.args || {});
          const stats = data.stats || {};

          // Sync with backend agent_status if available (CLI-consistent)
          const newTeams = data.agent_status
            ? syncTeamsFromAgentStatus(prev.teams, data.agent_status)
            : prev.teams;

          return {
            ...prev,
            stats: {
              ...prev.stats,
              llmCalls: stats.llm_calls ?? prev.stats.llmCalls,
              toolCalls: stats.tool_calls ?? prev.stats.toolCalls,
              tokensIn: stats.tokens_in ?? prev.stats.tokensIn,
              tokensOut: stats.tokens_out ?? prev.stats.tokensOut,
            },
            teams: newTeams,
            messages: [
              ...prev.messages,
              {
                time: new Date().toLocaleTimeString(),
                type: 'Tool',
                content: `${toolName}: ${args}`,
              },
            ],
          };
        });
        break;

      case 'data_message':
        setAnalysisState((prev) => {
          const stats = data.stats || {};

          // Sync with backend agent_status if available (CLI-consistent)
          const newTeams = data.agent_status
            ? syncTeamsFromAgentStatus(prev.teams, data.agent_status)
            : prev.teams;

          return {
            ...prev,
            stats: {
              ...prev.stats,
              llmCalls: stats.llm_calls ?? prev.stats.llmCalls,
              toolCalls: stats.tool_calls ?? prev.stats.toolCalls,
              tokensIn: stats.tokens_in ?? prev.stats.tokensIn,
              tokensOut: stats.tokens_out ?? prev.stats.tokensOut,
            },
            teams: newTeams,
            messages: [
              ...prev.messages,
              {
                time: new Date().toLocaleTimeString(),
                type: 'Data',
                content: data.content || '',
              },
            ],
          };
        });
        break;

      case 'control_message':
        setAnalysisState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              time: new Date().toLocaleTimeString(),
              type: 'Control',
              content: data.content || '',
            },
          ],
        }));
        break;

      case 'report_update':
        setAnalysisState((prev) => {
          const sectionTitles: Record<string, string> = {
            market_report: "Market Analysis",
            sentiment_report: "Social Sentiment",
            news_report: "News Analysis",
            fundamentals_report: "Fundamentals Analysis",
            investment_plan: "Research Team Decision",
            trader_investment_plan: "Trading Team Plan",
            final_trade_decision: "Portfolio Management Decision",
          };

          const title = sectionTitles[data.section] || data.section;
          const content = `### ${title}\n${data.content}`;

          // Sync with backend agent_status if available (CLI-consistent)
          const newTeams = data.agent_status
            ? syncTeamsFromAgentStatus(prev.teams, data.agent_status)
            : prev.teams;

          // Use backend report count (CLI-consistent)
          const completedReports = data.completed_reports ?? prev.reportCount.split('/')[0];
          const totalReports = data.total_reports ?? prev.reportCount.split('/')[1];

          const stats = data.stats || {};

          return {
            ...prev,
            stats: {
              ...prev.stats,
              llmCalls: stats.llm_calls ?? prev.stats.llmCalls,
              toolCalls: stats.tool_calls ?? prev.stats.toolCalls,
              tokensIn: stats.tokens_in ?? prev.stats.tokensIn,
              tokensOut: stats.tokens_out ?? prev.stats.tokensOut,
            },
            teams: newTeams,
            currentReport: content,
            reportCount: `${completedReports}/${totalReports}`,
          };
        });
        break;

      case 'agent_end':
        setAnalysisState((prev) => {
          const agentName = data.agent || 'Unknown Agent';
          const stats = data.stats || {};

          // Use backend agent_status for authoritative state (CLI-consistent)
          const newTeams = data.agent_status
            ? syncTeamsFromAgentStatus(prev.teams, data.agent_status)
            : updateAgentStatus(prev.teams, agentName, 'completed');

          // Use backend report count (CLI-consistent)
          const completedReports = data.completed_reports ?? prev.reportCount.split('/')[0];
          const totalReports = data.total_reports ?? prev.reportCount.split('/')[1];

          return {
            ...prev,
            stats: {
              ...prev.stats,
              llmCalls: stats.llm_calls ?? prev.stats.llmCalls,
              toolCalls: stats.tool_calls ?? prev.stats.toolCalls,
              tokensIn: stats.tokens_in ?? prev.stats.tokensIn,
              tokensOut: stats.tokens_out ?? prev.stats.tokensOut,
            },
            teams: newTeams,
            reportCount: `${completedReports}/${totalReports}`,
            messages: [
              ...prev.messages,
              {
                time: new Date().toLocaleTimeString(),
                type: 'Agent',
                content: data.content || `Agent ${agentName} completed analysis`,
              },
            ],
          };
        });
        break;

      case 'agent_error':
        setAnalysisState((prev) => {
          const agentName = data.agent || 'Unknown Agent';
          return {
            ...prev,
            teams: updateAgentStatus(prev.teams, agentName, 'error'),
            error: prev.error || data.error || null,
            messages: [
              ...prev.messages,
              {
                time: new Date().toLocaleTimeString(),
                type: 'Error',
                content: data.content || `Agent ${agentName} error: ${data.error}`,
              },
            ],
          };
        });
        break;

      case 'task_complete':
        setAnalysisState((prev) => {
          const isError = data.status === 'error';
          const isCancelled = data.status === 'cancelled';
          const st = data.stats || {};

          // Use backend agent_status for final state (CLI-consistent)
          const newTeams = data.agent_status
            ? syncTeamsFromAgentStatus(prev.teams, data.agent_status)
            : prev.teams.map((team) => ({
                ...team,
                agents: team.agents.map((agent) => ({
                  ...agent,
                  status:
                    isCancelled && agent.status === 'running'
                      ? 'error'
                      : isError && agent.status === 'running'
                        ? 'error'
                        : agent.status === 'running'
                          ? 'completed'
                          : agent.status,
                })),
              }));

          // Use backend report count (CLI-consistent)
          const completedReports = data.completed_reports ?? prev.reportCount.split('/')[0];
          const totalReports = data.total_reports ?? prev.reportCount.split('/')[1];

          return {
            ...prev,
            isAnalyzing: false,
            teams: newTeams,
            reportCount: `${completedReports}/${totalReports}`,
            stats: {
              ...prev.stats,
              llmCalls: st.llm_calls ?? prev.stats.llmCalls,
              toolCalls: st.tool_calls ?? prev.stats.toolCalls,
              tokensIn: st.tokens_in ?? prev.stats.tokensIn,
              tokensOut: st.tokens_out ?? prev.stats.tokensOut,
              endTime:
                (typeof data.timestamp === 'number' && Number.isFinite(data.timestamp)
                  ? data.timestamp
                  : Date.now() / 1000),
            },
            error: isError ? data.error_message || 'Analysis failed' : prev.error,
            messages: [
              ...prev.messages,
              {
                time: new Date().toLocaleTimeString(),
                type: isError ? 'Error' : 'System',
                content: isCancelled
                  ? 'Analysis cancelled'
                  : isError
                    ? `Analysis failed: ${data.error_message || 'Unknown error'}`
                    : 'Analysis completed successfully',
              },
            ],
            finalDecision:
              isCancelled || !data.final_decision
                ? null
                : {
                    decision: data.final_decision.decision,
                    signal: data.final_decision.signal ?? 'neutral',
                    dimensionConfidence:
                      data.final_decision.dimension_confidence ?? undefined,
                  },
          };
        });
        break;

      case 'task_cancelled':
        setAnalysisState((prev) => {
          const st = data.stats || {};
          return {
          ...prev,
          isAnalyzing: false,
          error: null,
          stats: {
            ...prev.stats,
            llmCalls: st.llm_calls ?? prev.stats.llmCalls,
            toolCalls: st.tool_calls ?? prev.stats.toolCalls,
            tokensIn: st.tokens_in ?? prev.stats.tokensIn,
            tokensOut: st.tokens_out ?? prev.stats.tokensOut,
            endTime:
              (typeof data.timestamp === 'number' && Number.isFinite(data.timestamp)
                ? data.timestamp
                : Date.now() / 1000),
          },
          teams: prev.teams.map((team) => ({
            ...team,
            agents: team.agents.map((agent) => ({
              ...agent,
              status: agent.status === 'running' ? 'error' : agent.status,
            })),
          })),
          messages: [
            ...prev.messages,
            {
              time: new Date().toLocaleTimeString(),
              type: 'System',
              content: 'Analysis cancelled by user',
            },
          ],
        };
        });
        break;

      case 'task_pre_cancel':
        setAnalysisState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              time: new Date().toLocaleTimeString(),
              type: 'System',
              content: 'Cancelling analysis...',
            },
          ],
        }));
        break;

      case 'task_post_cancel':
        setAnalysisState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              time: new Date().toLocaleTimeString(),
              type: 'System',
              content: 'Analysis cancelled',
            },
          ],
        }));
        break;

      default:
        // Handle unknown events
        console.log('Unknown SSE event:', event, data);
        break;
    }
  }, []);

  const startAnalysisProcess = useCallback(async (request: AnalysisRequest) => {
    try {
      seenEventIds.current.clear();
      setAnalysisState((prev) => ({
        ...prev,
        error: null,
        isAnalyzing: true,
        hasStarted: true,
        teams: buildInitialTeams(request),
        stats: {
          ...prev.stats,
          startTime: Date.now() / 1000,
          endTime: null,
        },
        messages: [
          {
            time: new Date().toLocaleTimeString(),
            type: 'System',
            content: `Starting analysis for ${request.ticker}...`,
          },
        ],
      }));

      const response = await startAnalysis(request);

      setAnalysisState((prev) => ({
        ...prev,
        taskId: response.task_id,
      }));
    } catch (error: any) {
      setAnalysisState((prev) => ({
        ...prev,
        isAnalyzing: false,
        error: error.message || 'Failed to start analysis',
      }));
    }
  }, []);

  const cancelAnalysisProcess = useCallback(async () => {
    if (!analysisState.taskId) return;

    try {
      await cancelTask(analysisState.taskId);
      setAnalysisState((prev) => ({
        ...prev,
        isAnalyzing: false,
      }));
    } catch (error: any) {
      setAnalysisState((prev) => ({
        ...prev,
        error: error.message || 'Failed to cancel analysis',
      }));
    }
  }, [analysisState.taskId]);

  const resetAnalysisProcess = useCallback(() => {
    try {
      sessionStorage.setItem(SKIP_ANALYSIS_RESUME_ONCE_KEY, '1');
    } catch {
      /* private mode */
    }
    seenEventIds.current.clear();
    setAnalysisState({
      isAnalyzing: false,
      hasStarted: false,
      taskId: null,
      teams: [],
      messages: [],
      finalDecision: null,
      error: null,
      currentReport: '',
      reportCount: '0/7',
      stats: {
        llmCalls: 0,
        toolCalls: 0,
        tokensIn: 0,
        tokensOut: 0,
        startTime: null,
        endTime: null,
      },
    });
  }, []);

  const resumeFromLocalReport = useCallback(
    async (report: {
      id: string;
      ticker: string;
      analysisDate: string;
      status?: 'running' | 'completed' | 'failed';
    }): Promise<ResumeFromStorageResult> => {
      seenEventIds.current.clear();
      try {
        // Fast path: non-running tasks can be restored directly from persisted history,
        // avoiding an extra /task call (which may 404 after backend restarts).
        if (report.status && report.status !== 'running') {
          try {
            const stored = await getStoredHistory(report.id);
            if (stored && typeof stored === 'object') {
              const row = stored as Record<string, unknown>;
              const ticker =
                typeof row.ticker === 'string' && row.ticker.trim()
                  ? row.ticker
                  : report.ticker;
              const analysisDate =
                typeof row.analysis_date === 'string' && row.analysis_date.trim()
                  ? row.analysis_date
                  : typeof row.analysisDate === 'string' && row.analysisDate.trim()
                    ? row.analysisDate
                    : report.analysisDate;
              const status = normalizeStoredStatus(row.status);
              const storedMessages = extractMessagesFromStoredReport(row);
              const finalDecision = extractFinalDecisionFromStoredReport(row);

              const cfg = row.configuration as Record<string, unknown> | undefined;
              const analystsRaw = cfg?.analyst_agent ?? cfg?.analysts;
              const analysts =
                Array.isArray(analystsRaw) && analystsRaw.every((x) => typeof x === 'string')
                  ? (analystsRaw as string[])
                  : undefined;
              const request: AnalysisRequest = {
                ticker,
                analysis_date: analysisDate,
              };
              if (analysts?.length) {
                request.runtime = {
                  llm_provider: String(cfg?.llm_provider ?? ''),
                  selected_analysts: analysts,
                };
              }

              let teams = buildInitialTeams(request);
              if (status !== 'running') {
                teams = teamsWithUniformAgentStatus(teams, 'completed');
              }
              const startTime =
                toEpochSeconds(row.started_at) ??
                toEpochSeconds(row.created_at) ??
                null;
              const endTime =
                toEpochSeconds(row.completed_at) ??
                (status === 'running' ? null : startTime);
              const errMsg =
                typeof row.error_message === 'string' ? row.error_message : null;

              setAnalysisState({
                isAnalyzing: false,
                hasStarted: true,
                taskId: report.id,
                teams,
                messages: storedMessages,
                finalDecision: status === 'completed' ? finalDecision : null,
                error: status === 'error' ? errMsg || 'Analysis failed' : null,
                currentReport: '',
                reportCount: '0/7',
                stats: {
                  llmCalls: 0,
                  toolCalls: 0,
                  tokensIn: 0,
                  tokensOut: 0,
                  startTime,
                  endTime,
                },
              });
              return { ok: true, ticker, analysisDate };
            }
          } catch {
            // fallback to /task path
          }
        }

        const status = await getTaskStatus(report.id);
        const statusMessages = normalizeMessages(status.messages);
        let storedMessages: AnalysisState['messages'] = [];
        try {
          const stored = await getStoredHistory(report.id);
          storedMessages = extractMessagesFromStoredReport(stored);
        } catch {
          storedMessages = [];
        }
        if (storedMessages.length === 0) {
          storedMessages = statusMessages;
        }
        const cfg = status.config as Record<string, unknown> | undefined;
        const analystsRaw = cfg?.analyst_agent ?? cfg?.analysts;
        const analysts =
          Array.isArray(analystsRaw) && analystsRaw.every((x) => typeof x === 'string')
            ? (analystsRaw as string[])
            : undefined;

        const request: AnalysisRequest = {
          ticker: status.ticker,
          analysis_date: status.analysis_date,
        };
        if (analysts?.length) {
          request.runtime = {
            llm_provider: String(cfg?.llm_provider ?? ''),
            selected_analysts: analysts,
          };
        }

        let initialTeams = buildInitialTeams(request);
        const ticker = status.ticker || report.ticker;
        const analysisDate = status.analysis_date || report.analysisDate;

        if (status.status === 'pending' || status.status === 'running') {
          const resumedStart =
            toEpochSeconds(status.started_at) ??
            toEpochSeconds(status.created_at) ??
            Date.now() / 1000;
          setAnalysisState({
            isAnalyzing: true,
            hasStarted: true,
            taskId: status.id,
            teams: initialTeams,
            messages:
              storedMessages.length > 0
                ? storedMessages
                : [
                    {
                      time: new Date().toLocaleTimeString(),
                      type: 'System',
                      content: `Resumed live progress for ${ticker}…`,
                    },
                  ],
            finalDecision: null,
            error: null,
            currentReport: '',
            reportCount: '0/7',
            stats: {
              llmCalls: 0,
              toolCalls: 0,
              tokensIn: 0,
              tokensOut: 0,
              startTime: resumedStart,
              endTime: null,
            },
          });
          return { ok: true, ticker, analysisDate };
        }

        if (status.status === 'completed') {
          const completedStart =
            toEpochSeconds(status.started_at) ??
            toEpochSeconds(status.created_at) ??
            null;
          const completedEnd =
            toEpochSeconds(status.completed_at) ?? completedStart ?? null;
          initialTeams = teamsWithUniformAgentStatus(initialTeams, 'completed');
          const fd = status.final_decision;
          setAnalysisState({
            isAnalyzing: false,
            hasStarted: true,
            taskId: status.id,
            teams: initialTeams,
            messages:
              storedMessages.length > 0
                ? storedMessages
                : [],
            finalDecision: fd
              ? {
                  decision: fd.decision,
                  signal: fd.signal ?? 'neutral',
                  dimensionConfidence: fd.dimension_confidence ?? undefined,
                }
              : null,
            error: null,
            currentReport: '',
            reportCount: '0/7',
            stats: {
              llmCalls: 0,
              toolCalls: 0,
              tokensIn: 0,
              tokensOut: 0,
              startTime: completedStart,
              endTime: completedEnd,
            },
          });
          return { ok: true, ticker, analysisDate };
        }

        if (status.status === 'error') {
          const errorStart =
            toEpochSeconds(status.started_at) ??
            toEpochSeconds(status.created_at) ??
            null;
          const errorEnd = toEpochSeconds(status.completed_at) ?? errorStart ?? null;
          initialTeams = teamsWithUniformAgentStatus(initialTeams, 'completed');
          const errMsg = status.error_message || 'Analysis failed';
          setAnalysisState({
            isAnalyzing: false,
            hasStarted: true,
            taskId: status.id,
            teams: initialTeams,
            messages:
              storedMessages.length > 0
                ? storedMessages
                : [
                    {
                      time: new Date().toLocaleTimeString(),
                      type: 'Error',
                      content: errMsg,
                    },
                  ],
            finalDecision: null,
            error: errMsg,
            currentReport: '',
            reportCount: '0/7',
            stats: {
              llmCalls: 0,
              toolCalls: 0,
              tokensIn: 0,
              tokensOut: 0,
              startTime: errorStart,
              endTime: errorEnd,
            },
          });
          return { ok: true, ticker, analysisDate };
        }

        if (status.status === 'cancelled') {
          const cancelledStart =
            toEpochSeconds(status.started_at) ??
            toEpochSeconds(status.created_at) ??
            null;
          const cancelledEnd =
            toEpochSeconds(status.completed_at) ?? cancelledStart ?? null;
          initialTeams = teamsWithUniformAgentStatus(initialTeams, 'completed');
          setAnalysisState({
            isAnalyzing: false,
            hasStarted: true,
            taskId: status.id,
            teams: initialTeams,
            messages:
              storedMessages.length > 0
                ? storedMessages
                : [
                    {
                      time: new Date().toLocaleTimeString(),
                      type: 'System',
                      content: 'This analysis was cancelled.',
                    },
                  ],
            finalDecision: null,
            error: null,
            currentReport: '',
            reportCount: '0/7',
            stats: {
              llmCalls: 0,
              toolCalls: 0,
              tokensIn: 0,
              tokensOut: 0,
              startTime: cancelledStart,
              endTime: cancelledEnd,
            },
          });
          return { ok: true, ticker, analysisDate };
        }

        return { ok: false };
      } catch (e: unknown) {
        const httpStatus =
          typeof e === 'object' && e !== null && 'response' in e
            ? (e as { response?: { status?: number } }).response?.status
            : undefined;
        if (httpStatus === 404) {
          try {
            const stored = await getStoredHistory(report.id);
            if (stored && typeof stored === 'object') {
              const row = stored as Record<string, unknown>;
              const ticker =
                typeof row.ticker === 'string' && row.ticker.trim()
                  ? row.ticker
                  : report.ticker;
              const analysisDate =
                typeof row.analysis_date === 'string' && row.analysis_date.trim()
                  ? row.analysis_date
                  : typeof row.analysisDate === 'string' && row.analysisDate.trim()
                    ? row.analysisDate
                    : report.analysisDate;
              const status = normalizeStoredStatus(row.status);
              const storedMessages = extractMessagesFromStoredReport(row);
              const finalDecision = extractFinalDecisionFromStoredReport(row);

              const cfg = row.configuration as Record<string, unknown> | undefined;
              const analystsRaw = cfg?.analyst_agent ?? cfg?.analysts;
              const analysts =
                Array.isArray(analystsRaw) && analystsRaw.every((x) => typeof x === 'string')
                  ? (analystsRaw as string[])
                  : undefined;
              const request: AnalysisRequest = {
                ticker,
                analysis_date: analysisDate,
              };
              if (analysts?.length) {
                request.runtime = {
                  llm_provider: String(cfg?.llm_provider ?? ''),
                  selected_analysts: analysts,
                };
              }

              let teams = buildInitialTeams(request);
              if (status !== 'running') {
                teams = teamsWithUniformAgentStatus(teams, 'completed');
              }
              const startTime =
                toEpochSeconds(row.started_at) ??
                toEpochSeconds(row.created_at) ??
                null;
              const endTime =
                toEpochSeconds(row.completed_at) ??
                (status === 'running' ? null : startTime);
              const errMsg =
                typeof row.error_message === 'string' ? row.error_message : null;

              setAnalysisState({
                isAnalyzing: false,
                hasStarted: true,
                taskId: report.id,
                teams,
                messages: storedMessages,
                finalDecision: status === 'completed' ? finalDecision : null,
                error: status === 'error' ? errMsg || 'Analysis failed' : null,
                currentReport: '',
                reportCount: '0/7',
                stats: {
                  llmCalls: 0,
                  toolCalls: 0,
                  tokensIn: 0,
                  tokensOut: 0,
                  startTime,
                  endTime,
                },
              });
              return { ok: true, ticker, analysisDate };
            }
          } catch {
            // no-op: fallback to local failure snapshot below
          }
          upsertFailedSnapshot({
            taskId: report.id,
            ticker: report.ticker,
            analysisDate: report.analysisDate,
            message: 'Task not found on server (expired or server restarted).',
          });
        }
        console.error('resumeFromLocalReport failed:', e);
        return { ok: false };
      }
    },
    [],
  );

  // Cleanup SSE connection on unmount
  useEffect(() => {
    return () => {
      // State will be cleaned up automatically by useSSE hook
    };
  }, []);

  return {
    ...analysisState,
    startAnalysis: startAnalysisProcess,
    cancelAnalysis: cancelAnalysisProcess,
    resetAnalysis: resetAnalysisProcess,
    resumeFromLocalReport,
  };
}