import { useState, useEffect, useRef } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Loader2,
  Play,
  Download,
  FileText,
  StopCircle,
  BarChart3,
  Database,
  CircleDashed,
  CheckCircle2,
  XCircle,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { ExportMenuPortal } from "./ExportMenuPortal";
import { RecommendationMarkdown } from "./RecommendationMarkdown";
import { getProfessionalHistoryExportUrl } from "../api/client";
import { CustomRadarChart } from "./CustomRadarChart";
import {
  upsertRunningReport,
  upsertCompletedSnapshot,
  upsertFailedSnapshot,
  getMostRecentReport,
} from "../utils/analysisReportsStorage";
import { applyProviderUsageDelta } from "../utils/providerUsageStorage";
import {
  useAnalysis,
  SKIP_ANALYSIS_RESUME_ONCE_KEY,
} from "../hooks/useAnalysis";
import type { Agent } from "../types";
import {
  type DataVendorKey,
  type DataVendorValue,
  mergeDataVendors,
} from "../config/dataVendors";
import {
  TRADING_AGENTS_CONFIG_STORAGE_KEY,
  decryptAlphaVantageKeyFromParsed,
} from "../utils/tradingAgentsConfigStorage";
import type { LlmProviderDefaults } from "../config/defaultProviders";
import { DEFAULT_LLM_PROVIDERS } from "../config/defaultProviders";
import { PROVIDERS_STORAGE_KEY } from "../utils/providerUsageStorage";

type ProviderConfig = LlmProviderDefaults;

interface SettingsConfig {
  outputLanguage?: string;
  analysts?: string[];
  researchDepth?: string;
  llmProvider?: string;
  alphaVantageApiKey?: string;
  dataVendors?: Record<DataVendorKey, DataVendorValue>;
}

const DEFAULT_SETTINGS: SettingsConfig = {
  outputLanguage: "english",
  analysts: ["market", "social", "news", "fundamentals"],
  researchDepth: "shallow",
  dataVendors: mergeDataVendors(undefined),
};

const VALID_ANALYSTS = ["market", "social", "news", "fundamentals"];
function resolveRuntimeProviderKey(provider: ProviderConfig): string {
  const base = provider.id.split("-")[0]?.toLowerCase() ?? "";
  const known = new Set([
    "openai",
    "anthropic",
    "google",
    "deepseek",
    "volcengine",
    "xai",
    "openrouter",
    "ollama",
  ]);
  if (known.has(base)) return base;
  return provider.name.trim().toLowerCase() || base || "openai";
}

// Map backend status to frontend status
const analysisExportMenuItemClass =
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-[#e6edf3] hover:bg-[#1c2128] focus-visible:bg-[#1c2128] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40";

function AnalysisInlineExportMenu({
  taskId,
  onServerPdf,
  onServerDocx,
}: {
  taskId: string | null;
  onServerPdf: () => void;
  onServerDocx: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const serverDisabled = !taskId;
  const serverTitle = serverDisabled
    ? "Missing task id — start or open an analysis to export"
    : undefined;

  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="relative inline-block shrink-0">
      <Button
        ref={triggerRef}
        type="button"
        className="bg-[#ffa657] hover:bg-[#ffb86c] text-[#0d1117] h-9 text-sm font-medium border-0"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <Download className="w-3.5 h-3.5 mr-1.5 shrink-0" />
        Export
      </Button>
      <ExportMenuPortal
        open={open}
        onRequestClose={() => setOpen(false)}
        anchorRef={triggerRef}
        align="end"
      >
          <button
            type="button"
            role="menuitem"
            disabled={serverDisabled}
            title={serverTitle}
            className={analysisExportMenuItemClass}
            onClick={() =>
              pick(() => {
                if (serverDisabled) return;
                onServerPdf();
              })
            }
          >
            <FileText className="w-4 h-4 shrink-0" />
            Export PDF
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={serverDisabled}
            title={serverTitle}
            className={analysisExportMenuItemClass}
            onClick={() =>
              pick(() => {
                if (serverDisabled) return;
                onServerDocx();
              })
            }
          >
            <FileText className="w-4 h-4 shrink-0" />
            Export DOCX
          </button>
      </ExportMenuPortal>
    </div>
  );
}

export function AnalysisPage() {
  const [ticker, setTicker] = useState("");
  const [analysisDate, setAnalysisDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [, setConfig] = useState<SettingsConfig | null>(null);
  const [nowSeconds, setNowSeconds] = useState(() => Date.now() / 1000);

  const loadProviders = (): ProviderConfig[] => {
    try {
      const savedProviders = localStorage.getItem(PROVIDERS_STORAGE_KEY);
      if (!savedProviders) return [...DEFAULT_LLM_PROVIDERS];
      const parsed = JSON.parse(savedProviders);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : [...DEFAULT_LLM_PROVIDERS];
    } catch (e) {
      console.error('Failed to load providers:', e);
      return [...DEFAULT_LLM_PROVIDERS];
    }
  };

  const loadSettings = async (): Promise<SettingsConfig> => {
    try {
      const saved = localStorage.getItem(TRADING_AGENTS_CONFIG_STORAGE_KEY);
      if (!saved) {
        return { ...DEFAULT_SETTINGS };
      }
      const parsed = JSON.parse(saved) as Record<string, unknown>;
      const avKey = await decryptAlphaVantageKeyFromParsed(parsed);
      const { alphaVantageApiKey: _a, alphaVantageApiKeySealed: _s, ...rest } =
        parsed;
      const filteredAnalysts = (parsed.analysts as string[] | undefined)?.filter(
        (a) => VALID_ANALYSTS.includes(a),
      );
      return {
        ...DEFAULT_SETTINGS,
        ...rest,
        analysts:
          filteredAnalysts && filteredAnalysts.length > 0
            ? filteredAnalysts
            : DEFAULT_SETTINGS.analysts,
        dataVendors: mergeDataVendors(
          parsed.dataVendors as SettingsConfig["dataVendors"],
        ),
        alphaVantageApiKey: avKey,
      };
    } catch (e) {
      console.error("Failed to parse config:", e);
      return { ...DEFAULT_SETTINGS };
    }
  };

  // Use the new analysis hook
  const {
    isAnalyzing,
    hasStarted,
    taskId,
    teams,
    messages,
    finalDecision,
    error,
    stats,
    startAnalysis,
    cancelAnalysis,
    resetAnalysis,
    resumeFromLocalReport,
  } = useAnalysis();

  useEffect(() => {
    let cancelled = false;
    try {
      if (sessionStorage.getItem(SKIP_ANALYSIS_RESUME_ONCE_KEY) === "1") {
        sessionStorage.removeItem(SKIP_ANALYSIS_RESUME_ONCE_KEY);
        return;
      }
    } catch {
      /* private mode */
    }

    const recent = getMostRecentReport();
    if (!recent?.id) return;

    void (async () => {
      const r = await resumeFromLocalReport({
        id: recent.id,
        ticker: recent.ticker,
        analysisDate: recent.analysisDate,
      });
      if (cancelled || !r.ok) return;
      setTicker(r.ticker);
      setAnalysisDate(r.analysisDate);
      toast.info("Restored latest local task", {
        description:
          recent.status === "running"
            ? "Reconnecting to live progress…"
            : "Synced status from server",
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [resumeFromLocalReport]);

  useEffect(() => {
    setNowSeconds(Date.now() / 1000);
    if (!isAnalyzing) return;
    const timer = window.setInterval(() => {
      setNowSeconds(Date.now() / 1000);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isAnalyzing]);

  const lastUsageTaskIdRef = useRef<string | null>(null);
  const prevSessionUsageRef = useRef({ in: 0, out: 0, llm: 0 });

  useEffect(() => {
    if (!taskId) {
      prevSessionUsageRef.current = { in: 0, out: 0, llm: 0 };
      lastUsageTaskIdRef.current = null;
      return;
    }
    if (taskId !== lastUsageTaskIdRef.current) {
      prevSessionUsageRef.current = { in: 0, out: 0, llm: 0 };
      lastUsageTaskIdRef.current = taskId;
    }
  }, [taskId]);

  useEffect(() => {
    if (!taskId || !hasStarted) return;
    void (async () => {
      const settings = await loadSettings();
      const providerId = settings.llmProvider;
      if (!providerId) return;

      const prev = prevSessionUsageRef.current;
      const dIn = stats.tokensIn - prev.in;
      const dOut = stats.tokensOut - prev.out;
      const dLlm = stats.llmCalls - prev.llm;
      if (dIn <= 0 && dOut <= 0 && dLlm <= 0) return;

      applyProviderUsageDelta(providerId, {
        inputTokens: dIn,
        outputTokens: dOut,
        llmCalls: dLlm,
      });
      prevSessionUsageRef.current = {
        in: stats.tokensIn,
        out: stats.tokensOut,
        llm: stats.llmCalls,
      };
    })();
  }, [
    stats.tokensIn,
    stats.tokensOut,
    stats.llmCalls,
    taskId,
    hasStarted,
  ]);

  useEffect(() => {
    void (async () => {
      const currentConfig = await loadSettings();
      setConfig(currentConfig);
    })();

    const savedProviders = localStorage.getItem(PROVIDERS_STORAGE_KEY);
    if (!savedProviders) {
      localStorage.setItem(
        PROVIDERS_STORAGE_KEY,
        JSON.stringify([...DEFAULT_LLM_PROVIDERS]),
      );
    }
  }, []);

  // Error handling effect
  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  useEffect(() => {
    if (!taskId || !hasStarted) return;
    if (isAnalyzing) {
      upsertRunningReport({
        taskId,
        ticker: ticker.trim(),
        analysisDate,
      });
      return;
    }
    if (finalDecision) {
      upsertCompletedSnapshot({
        taskId,
        ticker: ticker.trim(),
        analysisDate,
        decision: finalDecision.decision,
        signal: finalDecision.signal,
        dimensionConfidence: finalDecision.dimensionConfidence,
      });
      return;
    }
    if (error) {
      upsertFailedSnapshot({
        taskId,
        ticker: ticker.trim(),
        analysisDate,
        message: error,
      });
    }
  }, [
    taskId,
    hasStarted,
    isAnalyzing,
    finalDecision,
    error,
    ticker,
    analysisDate,
  ]);

  async function handleStartAnalysis() {
    if (!ticker.trim()) {
      toast.error("Please enter a ticker symbol");
      return;
    }

    const currentConfig = await loadSettings();
    const providers = loadProviders();

    if (!currentConfig.analysts || currentConfig.analysts.length === 0) {
      toast.error("Please select at least one analyst in Settings");
      return;
    }

    const selectedProviderId = currentConfig.llmProvider;
    if (!selectedProviderId) {
      toast.error("Please select an LLM provider in Settings");
      return;
    }

    const selectedProvider = providers.find((p) => p.id === selectedProviderId);
    if (!selectedProvider) {
      toast.error("Selected provider not found. Please reconfigure in Providers.");
      return;
    }

    // Keep UI state in sync with latest settings
    setConfig(currentConfig);

    startAnalysis({
      ticker: ticker.trim(),
      analysis_date: analysisDate,
      runtime: {
        llm_provider: resolveRuntimeProviderKey(selectedProvider),
        backend_url: selectedProvider.baseUrl,
        quick_think_llm: selectedProvider.quickThinkModel,
        deep_think_llm: selectedProvider.deepThinkModel,
        api_key: selectedProvider.apiKey,
        selected_analysts: currentConfig.analysts,
        output_language: currentConfig.outputLanguage,
        research_depth: currentConfig.researchDepth,
        alpha_vantage_api_key: currentConfig.alphaVantageApiKey,
        data_vendors: currentConfig.dataVendors,
      },
    });

    toast.success("Analysis started!");
  }

  function handleStopAnalysis() {
    const id = taskId;
    cancelAnalysis();
    if (id) {
      upsertFailedSnapshot({
        taskId: id,
        ticker: ticker.trim(),
        analysisDate,
        message: "Analysis cancelled",
      });
    }
    toast.info("Analysis stopped");
  }

  function handleResetAnalysis() {
    resetAnalysis();
    setTicker("");
    const today = new Date();
    setAnalysisDate(
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
    );
    toast.info("Analysis reset");
  }

  async function downloadProfessionalExport(
    format: "pdf" | "docx",
    enhanced: boolean,
    refreshEnhancement = false,
  ) {
    if (!taskId) {
      toast.error("No task id — start an analysis or open History to export.");
      return;
    }
    const ext = format;
    let filename = `TradingAgents_${ticker}_${analysisDate}_report.${ext}`.replace(
      /[/\\?%*:|"<>]/g,
      "-",
    );
    const url = getProfessionalHistoryExportUrl(taskId, format, {
      enhanced,
      refreshEnhancement,
    });
    try {
      const res = await fetch(url);
      if (!res.ok) {
        let detail = res.statusText;
        try {
          const j = (await res.json()) as { detail?: string };
          if (typeof j.detail === "string") detail = j.detail;
        } catch {
          /* ignore */
        }
        toast.error(detail || "Export failed");
        return;
      }
      const dispo = res.headers.get("Content-Disposition");
      if (dispo) {
        const star = /filename\*=UTF-8''([^;\s]+)/i.exec(dispo);
        const plain = /filename="([^"]+)"/i.exec(dispo);
        const raw = star?.[1] || plain?.[1];
        if (raw) {
          try {
            filename = decodeURIComponent(raw);
          } catch {
            filename = raw;
          }
        }
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
      toast.success(
        enhanced
          ? `Downloaded full report (${format.toUpperCase()})`
          : `Downloaded report appendix (${format.toUpperCase()})`,
      );
    } catch (e) {
      console.error(e);
      toast.error("Could not download export. Check that the API is running.");
    }
  }

  const agentStatusLabel = (status: Agent['status']): string => {
    switch (status) {
      case 'running':
        return 'In progress';
      case 'completed':
        return 'Completed';
      case 'error':
        return 'Error';
      default:
        return 'Pending';
    }
  };

  const AgentStatusIcon = ({ status }: { status: Agent['status'] }) => {
    const cls = 'w-3.5 h-3.5 shrink-0';
    switch (status) {
      case 'pending':
        return <CircleDashed className={`${cls} text-[#6e7681]`} strokeWidth={2} aria-hidden />;
      case 'running':
        return <Loader2 className={`${cls} animate-spin text-[#ae81ff]`} aria-hidden />;
      case 'completed':
        return <CheckCircle2 className={`${cls} text-[#a6e22e]`} strokeWidth={2} aria-hidden />;
      case 'error':
        return <XCircle className={`${cls} text-[#f92672]`} strokeWidth={2} aria-hidden />;
      default:
        return <CircleDashed className={`${cls} text-[#6e7681]`} strokeWidth={2} aria-hidden />;
    }
  };

  const formatTokens = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return n.toString();
  };

  const finalSignalLc = String(finalDecision?.signal ?? "").toLowerCase();
  const recommendationUi = finalSignalLc.includes("buy")
    ? {
        badge:
          "border-[#3fb950]/35 bg-[#3fb950]/[0.08] text-[#3fb950] shadow-[inset_0_0_0_1px_rgba(63,185,80,0.12)]",
        bar: "border-l-[#3fb950]",
        hero:
          "border-[#30363d] bg-[#0d1117] text-[#e6edf3] shadow-[inset_0_0_0_1px_rgba(63,185,80,0.16)]",
        heroAccent: "text-[#3fb950]",
      }
    : finalSignalLc.includes("sell")
      ? {
          badge:
            "border-[#f85149]/35 bg-[#f85149]/[0.08] text-[#f85149] shadow-[inset_0_0_0_1px_rgba(248,81,73,0.12)]",
          bar: "border-l-[#f85149]",
          hero:
            "border-[#30363d] bg-[#0d1117] text-[#e6edf3] shadow-[inset_0_0_0_1px_rgba(248,81,73,0.18)]",
          heroAccent: "text-[#f85149]",
        }
      : {
          badge:
            "border-[#ffa657]/35 bg-[#ffa657]/[0.08] text-[#ffa657] shadow-[inset_0_0_0_1px_rgba(255,166,87,0.12)]",
          bar: "border-l-[#ffa657]",
          hero:
            "border-[#30363d] bg-[#0d1117] text-[#e6edf3] shadow-[inset_0_0_0_1px_rgba(255,166,87,0.18)]",
          heroAccent: "text-[#ffa657]",
        };
  const dimensionConfidenceEntries = Object.entries(
    finalDecision?.dimensionConfidence || {},
  ).filter(([, val]) => Number.isFinite(val));
  const confidenceRadarMap = Object.fromEntries(
    dimensionConfidenceEntries.map(([k, v]) => [
      k,
      Math.max(0, Math.min(100, Math.round(Number(v)))),
    ]),
  );
  const averageConfidence =
    dimensionConfidenceEntries.length > 0
      ? Math.round(
          dimensionConfidenceEntries.reduce((acc, [, v]) => acc + Number(v), 0) /
            dimensionConfidenceEntries.length,
        )
      : null;

  /** Show export whenever a run has finished or stopped (not only when finalDecision is present). */
  const canExport = hasStarted && !isAnalyzing;
  const elapsedSeconds = (() => {
    if (!stats.startTime) return 0;
    const end = isAnalyzing ? nowSeconds : (stats.endTime ?? stats.startTime);
    return Math.max(0, Math.floor(end - stats.startTime));
  })();
  const elapsedDisplay = `${Math.floor(elapsedSeconds / 60)
    .toString()
    .padStart(2, "0")}:${(elapsedSeconds % 60).toString().padStart(2, "0")}`;

  const logScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      
      {/* Compact Header */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl text-[#e6edf3] font-semibold">Trading Analysis</h1>
            <p className="text-xs text-[#8b949e] mt-0.5">Real-time multi-agent analysis pipeline</p>
          </div>
          {hasStarted && (
            <div className="flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#0d1117] rounded border border-[#30363d]">
                <div className="w-1.5 h-1.5 bg-[#ffa657] rounded-full animate-pulse"></div>
                <span className="text-[#8b949e]">{ticker}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input Controls - More Compact */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div>
            <Label htmlFor="analysis-ticker" className="text-[#8b949e] mb-1.5 block text-xs font-medium">
              Ticker Symbol
            </Label>
            <Input
              id="analysis-ticker"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="SPY, AAPL, 0700.HK"
              disabled={isAnalyzing}
              className="bg-[#0d1117] border-[#30363d] text-[#e6edf3] placeholder:text-[#6e7681] focus:border-[#f85149] h-9 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="analysis-date" className="text-[#8b949e] mb-1.5 block text-xs font-medium">
              Analysis Date
            </Label>
            <Input
              id="analysis-date"
              type="date"
              value={analysisDate}
              onChange={(e) => setAnalysisDate(e.target.value)}
              disabled={isAnalyzing}
              className="bg-[#0d1117] border-[#30363d] text-[#e6edf3] focus:border-[#f85149] h-9 text-sm"
            />
          </div>
          <div className="flex items-end gap-2">
            {!hasStarted && (
              <Button
                onClick={handleStartAnalysis}
                disabled={isAnalyzing || !ticker.trim()}
                className="flex-1 bg-[#f85149] hover:bg-[#ff6b6b] text-white h-9 text-sm font-medium border-0"
              >
                <Play className="w-3.5 h-3.5 mr-1.5" />
                Start
              </Button>
            )}
            {hasStarted && isAnalyzing && (
              <Button
                onClick={handleStopAnalysis}
                className="flex-1 bg-[#3fb950]/10 text-[#3fb950] hover:bg-[#3fb950]/20 border border-[#3fb950]/30 h-9 text-sm"
              >
                <StopCircle className="w-3.5 h-3.5 mr-1.5" />
                Stop
              </Button>
            )}
            {hasStarted && (
              <Button
                onClick={handleResetAnalysis}
                variant="outline"
                className="border-[#30363d] text-[#8b949e] hover:bg-[#161b22] hover:text-[#e6edf3] h-9 text-sm px-3"
              >
                Reset
              </Button>
            )}
            {canExport && (
              <AnalysisInlineExportMenu
                taskId={taskId}
                onServerPdf={() => void downloadProfessionalExport("pdf", false, false)}
                onServerDocx={() => void downloadProfessionalExport("docx", false, false)}
              />
            )}
          </div>
        </div>
      </div>

      {hasStarted && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Progress Panel - Acting as a Sidebar */}
            <div className="lg:col-span-1 bg-[#0d1117] border border-[#30363d] rounded-lg p-4 flex flex-col overflow-hidden max-h-[min(50vh,420px)] lg:max-h-none">
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#30363d]">
                <BarChart3 className="w-4 h-4 text-[#ffa657]" />
                <h2 className="text-sm font-semibold text-[#e6edf3]">Execution Progress</h2>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                {teams.length === 0 ? (
                  <div className="text-center py-8 text-[#6e7681]">
                    <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" />
                    <span className="text-[11px]">Initializing...</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {teams.map((team, teamIdx) => (
                      <div key={teamIdx} className="space-y-2">
                        <h3 className="text-[11px] font-bold text-[#f92672] uppercase tracking-wider">{team.name}</h3>
                        <div className="space-y-1 pl-1">
                          {team.agents.map((agent, agentIdx) => (
                            <div key={`${teamIdx}-${agentIdx}`} className="flex items-center justify-between gap-2 text-[11px] group">
                              <span className="text-[#e6edf3] group-hover:text-white transition-colors truncate min-w-0">{agent.name}</span>
                              <div
                                className="flex items-center justify-center shrink-0 rounded p-0.5 transition-transform group-hover:scale-110"
                                title={agentStatusLabel(agent.status)}
                                role="img"
                                aria-label={agentStatusLabel(agent.status)}
                              >
                                <AgentStatusIcon status={agent.status} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Messages & Logs — fixed-height viewport, scroll inside */}
            <div className="lg:col-span-3 bg-[#0d1117] border border-[#30363d] rounded-lg p-4 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#30363d] shrink-0">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#ae81ff]" />
                  <h2 className="text-sm font-semibold text-[#e6edf3]">Live Streams & Logs</h2>
                </div>
                {isAnalyzing && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[#f85149]/10 text-[#f85149] rounded border border-[#f85149]/20 text-[10px]">
                    <span className="w-1 h-1 bg-[#f85149] rounded-full animate-ping"></span>
                    Live Trace
                  </div>
                )}
              </div>
              <div
                ref={logScrollRef}
                className="h-[400px] sm:h-[440px] lg:h-[480px] shrink-0 overflow-y-scroll overflow-x-hidden rounded-md border border-[#30363d]/50 bg-[#0a0e12] font-mono scroll-smooth [scrollbar-width:thin] [scrollbar-color:#484f58_#0d1117]"
              >
                {messages.length === 0 ? (
                  <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-[#6e7681] px-2 py-6">
                    <span className="text-xs">Connecting to graph stream...</span>
                  </div>
                ) : (
                  <div className="space-y-1 px-1 py-1">
                    {messages.map((msg, idx) => (
                      <div key={idx} className="flex items-start text-[11px] py-1 border-b border-[#30363d]/30 group last:border-0 hover:bg-[#161b22]/50 transition-colors px-2 rounded">
                        <div className="w-16 text-[#6e7681] flex-shrink-0 tabular-nums">{msg.time.split(' ')[0]}</div>
                        <div className={`w-16 font-semibold flex-shrink-0 text-center uppercase tracking-tighter ${
                          msg.type === 'Tool' || msg.type === 'Data' ? 'text-[#a6e22e]' :
                          msg.type === 'System' ? 'text-[#66d9ef]' :
                          msg.type === 'Agent' ? 'text-[#ae81ff]' :
                          msg.type === 'Thought' ? 'text-[#e6db74]' :
                          msg.type === 'Control' ? 'text-[#ffa657]' :
                          msg.type === 'Error' ? 'text-[#f85149]' :
                          'text-[#e6edf3]'
                        }`}>
                          [{msg.type}]
                        </div>
                        <div className="flex-1 break-words text-[#e6edf3] ml-3 leading-relaxed">
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {isAnalyzing && (
                      <div className="flex items-center gap-2 text-[#6e7681] text-[10px] italic py-2 px-2">
                        <span className="animate-pulse">_</span> 
                        <span>Waiting for next trace...</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Analysis Results - Shown when complete */}
          {finalDecision && (
            <div className="animate-in slide-in-from-bottom-3 fade-in duration-500 rounded-xl border border-[#30363d] bg-[#161b22] shadow-[0_8px_28px_rgba(0,0,0,0.35)]">
              <div className="border-b border-[#30363d] bg-gradient-to-r from-[#0d1117] via-[#121821] to-[#0d1117] px-4 py-4 md:px-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#f85149]/30 bg-[#f85149]/[0.12]">
                      <Target className="h-5 w-5 text-[#f85149]" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold leading-tight text-[#e6edf3] md:text-base">
                        Investment Recommendation
                      </h2>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#8b949e]">
                        <span className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.5 font-mono">
                          {ticker.trim() || "—"}
                        </span>
                        <span className="text-[#484f58]">•</span>
                        <span>{analysisDate}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 md:p-5">
                <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
                  <aside className="space-y-3">
                    <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#8b949e]">
                        Decision & Confidence
                      </p>
                      <div className={`rounded-xl border px-3 py-3 md:px-4 md:py-3 ${recommendationUi.hero}`}>
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8b949e]">
                          Final Action
                        </p>
                        <div className="mt-1 flex items-end justify-between gap-3">
                          <p className={`text-2xl font-extrabold leading-none tracking-wide md:text-3xl ${recommendationUi.heroAccent}`}>
                            {String(finalDecision.signal ?? "—").toUpperCase()}
                          </p>
                          <div className="text-right text-[11px] text-[#8b949e]">
                            <p>Primary recommendation</p>
                            {averageConfidence !== null && (
                              <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-[#ffa657]/40 bg-[#ffa657]/10 px-2 py-0.5">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[#ffa657]">
                                  Avg confidence
                                </span>
                                <span className="text-sm font-extrabold leading-none text-[#ffd8a8]">
                                  {averageConfidence}%
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {dimensionConfidenceEntries.length > 0 && (
                        <div className="mt-3">
                          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#6e7681]">
                            Confidence Radar
                          </p>
                          <div className="rounded-md border border-[#30363d]/70 bg-[#111823] p-2">
                            <CustomRadarChart data={confidenceRadarMap} compact />
                          </div>
                        </div>
                      )}
                    </div>
                  </aside>

                  <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#6e7681]">
                      Rationale
                    </p>
                    <div
                      className={`rounded-lg border border-[#30363d] border-l-4 bg-[#0d1117] px-4 py-4 md:px-5 md:py-5 ${recommendationUi.bar}`}
                    >
                      <RecommendationMarkdown
                        className="[word-break:break-word] md:prose-base"
                        markdown={finalDecision.decision ?? ""}
                      />
                    </div>
                  </section>
                </div>
              </div>
            </div>
          )}

          {/* Stats Status Bar */}
          <div className="bg-[#161b22] border border-[#30363d] rounded p-2 flex items-center justify-between text-[11px] text-[#8b949e]">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-[#f85149] rounded-full"></div>
                <span>Analyzed: <span className="text-[#e6edf3]">{teams.flatMap(t => t.agents).filter(a => a.status === 'completed').length}/{teams.flatMap(t => t.agents).length} Agents</span></span>
              </div>
              <div className="flex items-center gap-4 border-l border-[#30363d] pl-6">
                <span>LLM Calls: <span className="text-[#e6edf3]">{stats.llmCalls}</span></span>
                <span>Tools: <span className="text-[#e6edf3]">{stats.toolCalls}</span></span>
                <span>Tokens: <span className="text-[#3fb950]">{formatTokens(stats.tokensIn)} in</span> / <span className="text-[#ae81ff]">{formatTokens(stats.tokensOut)} out</span></span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className={isAnalyzing ? "text-[#ffa657] animate-pulse" : "text-[#8b949e]"}>●</span>
                {isAnalyzing ? "Analyzing Performance..." : "Process Finished"}
              </span>
              <div className="bg-[#0a0e14] px-3 py-1 rounded border border-[#30363d] font-mono text-[#ffa657]">
                {elapsedDisplay}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}