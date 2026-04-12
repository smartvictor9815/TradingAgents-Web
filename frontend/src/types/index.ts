/** Types shared by analysis UI (useAnalysis / AnalysisPage). */

export interface Message {
  time: string;
  type: "System" | "Agent" | "Tool" | "Data" | "Error";
  content: string;
}

export interface Agent {
  name: string;
  status: "pending" | "running" | "completed" | "error";
  content?: string;
}

export interface Team {
  name: string;
  agents: Agent[];
}
