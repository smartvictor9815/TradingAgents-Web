/** Types shared by analysis UI (useAnalysis / AnalysisPage). */

export interface Agent {
  name: string;
  status: "pending" | "running" | "completed" | "error";
  content?: string;
}
