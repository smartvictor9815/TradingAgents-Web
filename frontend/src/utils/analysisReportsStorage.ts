import type { Report } from '../types/report';

export const STORAGE_KEY = 'tradingagents-reports';

export function signalToAction(signal?: string | null): 'BUY' | 'SELL' | 'HOLD' {
  const s = (signal || '').toLowerCase();
  if (s.includes('sell') || s.includes('bear')) return 'SELL';
  if (s.includes('buy') || s.includes('bull')) return 'BUY';
  return 'HOLD';
}

function coerceReport(raw: unknown): Report | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string') return null;
  const st = o.status;
  const status: Report['status'] =
    st === 'running' || st === 'completed' || st === 'failed' ? st : 'failed';
  const summary = typeof o.summary === 'string' ? o.summary : '';
  const steps: Report['steps'] = Array.isArray(o.steps)
    ? (o.steps as Report['steps'])
    : [
        {
          name: 'Summary',
          status: status === 'running' ? 'running' : 'completed',
          details: summary || '—',
        },
      ];
  return {
    id: o.id,
    ticker: typeof o.ticker === 'string' ? o.ticker : '',
    analysisDate:
      typeof o.analysisDate === 'string'
        ? o.analysisDate
        : typeof o.analysis_date === 'string'
          ? o.analysis_date
          : '',
    timestamp:
      typeof o.timestamp === 'string' ? o.timestamp : new Date().toISOString(),
    status,
    summary,
    steps,
    recommendation: o.recommendation as Report['recommendation'],
    agentConfidence: o.agentConfidence as Report['agentConfidence'],
    priceData: o.priceData as Report['priceData'],
    portfolioPerformance: o.portfolioPerformance as Report['portfolioPerformance'],
  };
}

export function loadReportsFromStorage(): Report[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: Report[] = [];
    for (const row of parsed) {
      const r = coerceReport(row);
      if (r) out.push(r);
    }
    return out;
  } catch {
    return [];
  }
}

/** Newest report by `timestamp` (ISO), for resuming after leaving the analysis page. */
export function getMostRecentReport(): Report | null {
  const all = loadReportsFromStorage();
  if (all.length === 0) return null;
  return [...all].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  )[0];
}

function writeAll(reports: Report[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

export function upsertReport(partial: Report) {
  const all = loadReportsFromStorage();
  const idx = all.findIndex((r) => r.id === partial.id);
  const next = { ...(idx >= 0 ? all[idx] : {}), ...partial } as Report;
  if (idx >= 0) {
    all[idx] = next;
  } else {
    all.unshift(next);
  }
  writeAll(all);
}

export function upsertRunningReport(params: {
  taskId: string;
  ticker: string;
  analysisDate: string;
}) {
  upsertReport({
    id: params.taskId,
    ticker: params.ticker,
    analysisDate: params.analysisDate,
    timestamp: new Date().toISOString(),
    status: 'running',
    summary: 'Analysis in progress…',
    steps: [
      { name: 'Progress', status: 'running', details: 'Waiting for agents…' },
    ],
  });
}

export function upsertCompletedSnapshot(params: {
  taskId: string;
  ticker: string;
  analysisDate: string;
  decision: string;
  signal?: string;
  dimensionConfidence?: Record<string, number>;
}) {
  const { decision, signal, dimensionConfidence } = params;
  const vals = Object.values(dimensionConfidence || {}).filter(
    (v): v is number => Number.isFinite(v),
  );
  const avgConfidence =
    vals.length > 0
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      : 50;
  upsertReport({
    id: params.taskId,
    ticker: params.ticker,
    analysisDate: params.analysisDate,
    timestamp: new Date().toISOString(),
    status: 'completed',
    summary: decision,
    steps: [{ name: 'Result', status: 'completed', details: decision }],
    recommendation: {
      action: signalToAction(signal),
      confidence: avgConfidence,
      reasoning: decision,
    },
    agentConfidence: dimensionConfidence,
  });
}

export function upsertFailedSnapshot(params: {
  taskId: string;
  ticker: string;
  analysisDate: string;
  message: string;
}) {
  upsertReport({
    id: params.taskId,
    ticker: params.ticker,
    analysisDate: params.analysisDate,
    timestamp: new Date().toISOString(),
    status: 'failed',
    summary: params.message,
    steps: [
      { name: 'Error', status: 'failed', details: params.message },
    ],
  });
}

export function removeReportFromStorage(taskId: string) {
  writeAll(loadReportsFromStorage().filter((r) => r.id !== taskId));
}
