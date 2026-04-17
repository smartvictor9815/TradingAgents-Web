import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Clock, TrendingUp, ChevronRight, Download, Trash2, ArrowLeft, Target, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { CustomRadarChart } from "./CustomRadarChart";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { Report } from "../types/report";
import {
  loadReportsFromStorage,
  removeReportFromStorage,
  STORAGE_KEY,
  signalToAction,
} from "../utils/analysisReportsStorage";
import {
  listStoredHistory,
  getStoredHistory,
  deleteStoredHistory,
  getProfessionalHistoryExportUrl,
  type StoredHistoryListItem,
} from "../api/client";
import { ExportMenuPortal } from "./ExportMenuPortal";

const exportMenuItemClass =
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-[#e6edf3] hover:bg-[#1c2128] focus-visible:bg-[#1c2128] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40";

function HistoryMarkdown({
  markdown,
  compact = false,
  className = "",
}: {
  markdown: string;
  compact?: boolean;
  className?: string;
}) {
  const md = markdown?.trim() ?? "";
  if (!md) {
    return <span className="text-[#6e7681]">—</span>;
  }

  return (
    <div
      className={`prose prose-invert max-w-none text-[#8b949e] prose-p:my-1 prose-headings:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-1 prose-pre:bg-[#0d1117] prose-pre:border prose-pre:border-[#30363d] prose-code:text-[#ffa657] prose-code:before:content-none prose-code:after:content-none ${
        compact ? "prose-xs max-h-10 overflow-hidden" : "prose-sm"
      } ${className}`.trim()}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </div>
  );
}

function ReportExportMenu({
  report,
  variant,
  triggerServerFullExport,
}: {
  report: Report;
  variant: "header" | "row";
  triggerServerFullExport: (
    r: Report,
    format: "markdown" | "pdf" | "docx",
    enhanced: boolean,
    refreshEnhancement?: boolean,
  ) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const serverDisabled = report.status !== "completed";
  const serverTitle = serverDisabled
    ? "Available when analysis status is completed"
    : undefined;

  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="relative inline-block shrink-0">
      {variant === "header" ? (
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          className="border-[#30363d] text-[#ffa657] hover:bg-[#ffa657]/10 h-8 text-xs px-2.5"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((o) => !o)}
        >
          <Download className="w-3.5 h-3.5 mr-1 shrink-0" />
          Export
        </Button>
      ) : (
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="sm"
          className="text-[#ffa657] hover:bg-[#ffa657]/10 h-7 px-2"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Download className="w-3.5 h-3.5" />
        </Button>
      )}
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
            className={exportMenuItemClass}
            onClick={() =>
              pick(() => {
                if (serverDisabled) return;
                void triggerServerFullExport(report, "pdf", false, false);
              })
            }
          >
            <FileText className="w-3.5 h-3.5 shrink-0" />
            Export PDF
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={serverDisabled}
            title={serverTitle}
            className={exportMenuItemClass}
            onClick={() =>
              pick(() => {
                if (serverDisabled) return;
                void triggerServerFullExport(report, "docx", false, false);
              })
            }
          >
            <FileText className="w-3.5 h-3.5 shrink-0" />
            Export DOCX
          </button>
      </ExportMenuPortal>
    </div>
  );
}

function mergeReportLists(local: Report[], server: Report[]): Report[] {
  const byId = new Map<string, Report>();
  for (const r of local) {
    if (r.status === "running") byId.set(r.id, r);
  }
  for (const r of server) {
    byId.set(r.id, r);
  }
  for (const r of local) {
    if (!byId.has(r.id)) byId.set(r.id, r);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

function serverListItemToReport(item: StoredHistoryListItem): Report {
  const summary = item.summary_preview || "";
  const signal = item.signal ?? undefined;
  return {
    id: item.task_id,
    ticker: item.ticker,
    analysisDate: item.analysis_date,
    timestamp: item.completed_at || item.created_at || new Date().toISOString(),
    status: "completed",
    summary,
    steps: [
      {
        name: "Overview",
        status: "completed",
        details: summary || "—",
      },
    ],
    recommendation: summary
      ? {
          action: signalToAction(signal),
          confidence: 50,
          reasoning: summary,
        }
      : undefined,
  };
}

function fullServerJsonToReport(json: Record<string, unknown>): Report {
  const taskId = String(json.task_id || "");
  const fd = (json.results || {}) as Record<string, unknown>;
  const decision = typeof fd.decision === "string" ? fd.decision : "";
  const signal = typeof fd.signal === "string" ? fd.signal : undefined;
  const dimensionConfidence =
    fd.dimension_confidence && typeof fd.dimension_confidence === "object"
      ? (fd.dimension_confidence as Record<string, number>)
      : undefined;
  const dcVals = Object.values(dimensionConfidence || {}).filter(
    (v): v is number => Number.isFinite(v),
  );
  const confidenceAvg =
    dcVals.length > 0 ? Math.round(dcVals.reduce((a, b) => a + b, 0) / dcVals.length) : 50;
  const statusRaw = String(json.status || "").toLowerCase();
  const status: Report["status"] =
    statusRaw === "completed"
      ? "completed"
      : statusRaw === "running"
        ? "running"
        : "failed";
  const messages = Array.isArray(json.messages) ? json.messages : [];
  const steps: Report["steps"] = messages.map((m: unknown, i: number) => {
    const row = m as Record<string, unknown>;
    return {
      name: `${String(row.type || "Step")}${messages.length > 1 ? ` ${i + 1}` : ""}`,
      status: "completed" as const,
      details: String(row.content || ""),
    };
  });
  const summary =
    decision ||
    (typeof json.error_message === "string" ? json.error_message : "") ||
    "";
  if (!steps.length) {
    steps.push({
      name: "Summary",
      status: status === "failed" ? "failed" : "completed",
      details: summary || "—",
    });
  }
  return {
    id: taskId,
    ticker: String(json.ticker || ""),
    analysisDate: String(json.analysis_date || json.analysisDate || ""),
    timestamp: String(
      json.completed_at || json.created_at || new Date().toISOString()
    ),
    status,
    summary,
    steps,
    recommendation: decision
      ? {
          action: signalToAction(signal),
          confidence: confidenceAvg,
          reasoning: decision,
        }
      : undefined,
    agentConfidence: dimensionConfidence,
  };
}

export function ReportsPage() {
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    const local = loadReportsFromStorage();
    try {
      const serverItems = await listStoredHistory();
      const server = serverItems.map(serverListItemToReport);
      const merged = mergeReportLists(local, server);
      setReports(merged);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
      setReports(local);
    }
  };

  const openReport = async (report: Report) => {
    try {
      const data = await getStoredHistory(report.id);
      if (data && typeof data === "object") {
        setSelectedReport(fullServerJsonToReport(data));
        return;
      }
    } catch {
      /* use cached row */
    }
    setSelectedReport(report);
  };

  const deleteReport = async (id: string) => {
    try {
      await deleteStoredHistory(id);
    } catch {
      /* still drop local copy */
    }
    removeReportFromStorage(id);
    const updated = reports.filter((r) => r.id !== id);
    setReports(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    if (selectedReport?.id === id) {
      setSelectedReport(null);
    }
    toast.success("History entry deleted successfully");
  };

  const triggerServerFullExport = async (
    report: Report,
    format: "markdown" | "pdf" | "docx",
    enhanced: boolean,
    refreshEnhancement = false,
  ) => {
    if (report.status !== "completed") {
      toast.error("Export is only available for completed analyses.");
      return;
    }
    const url = getProfessionalHistoryExportUrl(report.id, format, {
      enhanced,
      refreshEnhancement,
    });
    const ext = format === "markdown" ? "md" : format;
    let filename = `TradingAgents_${report.ticker}_${report.analysisDate}_report.${ext}`.replace(
      /[/\\?%*:|"<>]/g,
      "-",
    );
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
          ? "History export downloaded (full report + AI synthesis)"
          : "History export downloaded",
      );
    } catch (e) {
      console.error(e);
      toast.error("Could not download export. Check that the API is running.");
    }
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (selectedReport) {
    return (
      <div className="max-w-5xl mx-auto space-y-4 pb-6">

        {/* Compact Header */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <Button
            variant="ghost"
            onClick={() => setSelectedReport(null)}
            className="text-[#ffa657] hover:text-[#ffb86c] hover:bg-[#ffa657]/10 mb-3 -ml-2 h-8 text-xs"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
            Back to History
          </Button>
          
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl text-[#e6edf3] font-semibold flex items-center gap-2.5">
                <FileText className="w-6 h-6 text-[#f85149]" />
                Analysis Report: {selectedReport.ticker}
              </h1>
              <div className="flex gap-3 text-xs text-[#6e7681] mt-1">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {formatDate(selectedReport.timestamp)}
                </span>
                <span>Analysis: {selectedReport.analysisDate}</span>
              </div>
            </div>
            <div className="flex gap-1.5">
              <ReportExportMenu
                variant="header"
                report={selectedReport}
                triggerServerFullExport={triggerServerFullExport}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (confirm(`Delete history entry for ${selectedReport.ticker}?`)) {
                    deleteReport(selectedReport.id);
                  }
                }}
                className="border-[#30363d] text-[#3fb950] hover:bg-[#3fb950]/10 h-8 px-2.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <h2 className="text-sm text-[#e6edf3] font-semibold flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-[#f85149]" />
            Summary
          </h2>
          <HistoryMarkdown
            markdown={selectedReport.summary}
            className="text-xs leading-relaxed"
          />
        </div>

        {/* Recommendation */}
        {selectedReport.recommendation && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
            <h2 className="text-sm text-[#e6edf3] font-semibold mb-3">Recommendation</h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1.5 rounded text-xs font-bold ${
                  selectedReport.recommendation.action === 'BUY' ? 'bg-[#f85149] text-white' :
                  selectedReport.recommendation.action === 'SELL' ? 'bg-[#3fb950] text-white' :
                  'bg-[#ffa657] text-white'
                }`}>
                  {selectedReport.recommendation.action}
                </span>
                <span className="text-[#8b949e] text-xs">
                  Confidence: <span className="font-semibold text-[#ffa657]">{selectedReport.recommendation.confidence}%</span>
                </span>
              </div>
              <div className="text-xs text-[#8b949e] leading-relaxed">
                <p className="text-[#6e7681] mb-1">Reasoning:</p>
                <HistoryMarkdown
                  markdown={selectedReport.recommendation.reasoning}
                  className="text-xs leading-relaxed"
                />
              </div>
            </div>
          </div>
        )}

        {/* Agent Confidence Radar */}
        {selectedReport.agentConfidence && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
            <h2 className="text-sm text-[#e6edf3] font-semibold mb-3 flex items-center gap-2">
              <Target className="w-4 h-4 text-[#f85149]" />
              Agent Confidence & Sentiment Radar
            </h2>
            <CustomRadarChart data={selectedReport.agentConfidence} />
          </div>
        )}

        {/* Price Trend Chart */}
        {selectedReport.priceData && selectedReport.priceData.length > 0 && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
            <h2 className="text-sm text-[#e6edf3] font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#f85149]" />
              Price Trend Analysis
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={selectedReport.priceData}>
                <defs>
                  <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f85149" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f85149" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                <XAxis 
                  dataKey="date" 
                  stroke="#8b949e" 
                  tick={{ fill: '#8b949e', fontSize: 11 }}
                />
                <YAxis 
                  stroke="#8b949e" 
                  tick={{ fill: '#8b949e', fontSize: 11 }}
                  domain={['dataMin - 5', 'dataMax + 5']}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#161b22', 
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    fontSize: '12px'
                  }}
                  labelStyle={{ color: '#e6edf3' }}
                  itemStyle={{ color: '#f85149' }}
                />
                <Legend 
                  wrapperStyle={{ fontSize: '12px' }}
                  iconSize={12}
                />
                <Area 
                  type="monotone" 
                  dataKey="price" 
                  stroke="#f85149" 
                  fillOpacity={1} 
                  fill="url(#colorPrice)"
                  strokeWidth={2}
                  name="Price ($)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Portfolio Performance Chart */}
        {selectedReport.portfolioPerformance && selectedReport.portfolioPerformance.length > 0 && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
            <h2 className="text-sm text-[#e6edf3] font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#ffa657]" />
              Portfolio Performance vs Benchmark
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={selectedReport.portfolioPerformance}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                <XAxis 
                  dataKey="date" 
                  stroke="#8b949e" 
                  tick={{ fill: '#8b949e', fontSize: 11 }}
                />
                <YAxis 
                  stroke="#8b949e" 
                  tick={{ fill: '#8b949e', fontSize: 11 }}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#161b22', 
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    fontSize: '12px'
                  }}
                  labelStyle={{ color: '#e6edf3' }}
                />
                <Legend 
                  wrapperStyle={{ fontSize: '12px' }}
                  iconSize={12}
                />
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#f85149" 
                  strokeWidth={2}
                  dot={{ fill: '#f85149', r: 3 }}
                  name="Portfolio Value ($)"
                />
                <Line 
                  type="monotone" 
                  dataKey="benchmark" 
                  stroke="#ffa657" 
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ fill: '#ffa657', r: 3 }}
                  name="Benchmark ($)"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Analysis Steps */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <h2 className="text-sm text-[#e6edf3] font-semibold mb-3">Detailed Analysis Steps</h2>
          <div className="space-y-2.5">
            {selectedReport.steps.map((step, idx) => (
              <div key={idx} className="border border-[#30363d] rounded p-3 bg-[#0d1117]">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-[#e6edf3] text-xs font-semibold flex items-center gap-2">
                    <span className="text-[#ffa657] font-mono">{idx + 1}.</span>
                    {step.name}
                  </h3>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    step.status === 'completed' ? 'bg-[#f85149] text-white' :
                    step.status === 'running' ? 'bg-[#ffa657] text-white' :
                    step.status === 'failed' ? 'bg-[#3fb950] text-white' :
                    'bg-[#30363d] text-[#8b949e]'
                  }`}>
                    {step.status.toUpperCase()}
                  </span>
                </div>
                {step.timestamp && (
                  <p className="text-xs text-green-600 mb-2">
                    {formatDate(step.timestamp)}
                  </p>
                )}
                <HistoryMarkdown
                  markdown={step.details}
                  className="text-sm text-gray-300 leading-relaxed"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4 pb-6">
      
      {/* Compact Header */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
        <h1 className="text-xl text-[#e6edf3] font-semibold flex items-center gap-2.5">
          <FileText className="w-6 h-6 text-[#f85149]" />
          Analysis History
        </h1>
        <p className="text-xs text-[#8b949e] mt-0.5">View and manage completed analysis history</p>
      </div>

      {/* History List */}
      {reports.length === 0 ? (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-12 text-center">
          <FileText className="w-12 h-12 text-[#6e7681] mx-auto mb-3" />
          <p className="text-[#8b949e] text-sm mb-1">No history yet</p>
          <p className="text-[#6e7681] text-xs">
            Complete an analysis to generate your first history entry
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {reports.map((report) => (
            <div
              key={report.id}
              className="bg-[#161b22] border border-[#30363d] rounded-lg p-3.5 hover:bg-[#1c2128] transition-colors cursor-pointer group"
              onClick={() => void openReport(report)}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className="text-sm text-[#e6edf3] font-semibold">
                      {report.ticker}
                    </h3>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      report.status === 'completed' ? 'bg-[#f85149] text-white' :
                      report.status === 'running' ? 'bg-[#ffa657] text-white' :
                      'bg-[#3fb950] text-white'
                    }`}>
                      {report.status.toUpperCase()}
                    </span>
                    {report.recommendation && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        report.recommendation.action === 'BUY' ? 'bg-[#f85149] text-white' :
                        report.recommendation.action === 'SELL' ? 'bg-[#3fb950] text-white' :
                        'bg-[#ffa657] text-white'
                      }`}>
                        {report.recommendation.action}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 text-[10px] text-[#6e7681] mb-1.5">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(report.timestamp)}
                    </span>
                    <span>Analysis: {report.analysisDate}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 ml-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate("/analysis", {
                        state: {
                          resumeHint: {
                            id: report.id,
                            ticker: report.ticker,
                            analysisDate: report.analysisDate,
                            status: report.status,
                          },
                        },
                      });
                    }}
                    className="text-[#66d9ef] hover:bg-[#66d9ef]/10 h-7 px-2 text-[10px]"
                    title="Open this report in Analysis view"
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1" />
                    Open in Analysis
                  </Button>
                  <ReportExportMenu
                    variant="row"
                    report={report}
                    triggerServerFullExport={triggerServerFullExport}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete history entry for ${report.ticker}?`)) {
                        deleteReport(report.id);
                      }
                    }}
                    className="text-[#3fb950] hover:bg-[#3fb950]/10 h-7 px-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                  <ChevronRight className="w-4 h-4 text-[#f85149] group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}