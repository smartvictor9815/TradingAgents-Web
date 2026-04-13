import axios from 'axios';

// Create axios instance with base configuration
const apiClient = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for adding auth tokens or other headers
apiClient.interceptors.request.use(
  (config) => {
    // Add auth token if needed
    // const token = localStorage.getItem('auth-token');
    // if (token) {
    //   config.headers.Authorization = `Bearer ${token}`;
    // }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for handling common errors
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Handle common errors
    if (error.response?.status === 401) {
      // Handle unauthorized access
      console.error('Unauthorized access - redirecting to login');
    } else if (error.response?.status === 500) {
      console.error('Server error occurred');
    }

    return Promise.reject(error);
  }
);

// API Types
export interface AnalysisRuntime {
  llm_provider: string;
  backend_url?: string;
  quick_think_llm?: string;
  deep_think_llm?: string;
  api_key?: string;
  selected_analysts: string[];
  output_language?: string;
  research_depth?: string;
  alpha_vantage_api_key?: string;
  /** Mirrors backend tradingagents DEFAULT_CONFIG["data_vendors"] */
  data_vendors?: Record<string, string>;
}

export interface AnalysisRequest {
  ticker: string;
  analysis_date: string;
  runtime?: AnalysisRuntime;
}

export interface TaskStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'error';
  ticker: string;
  analysis_date: string;
  config: Record<string, unknown>;
  final_decision: {
    decision: string;
    signal: string;
    dimension_confidence?: Record<string, number>;
  } | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  messages?: Array<{
    time?: string;
    type?: string;
    content?: string;
  }>;
}

// API Functions
export const startAnalysis = async (request: AnalysisRequest) => {
  const response = await apiClient.post('/analyze', request);
  return response.data;
};

export interface AlphaVantageKeyValidateResponse {
  ok: boolean;
  message?: string;
}

/** Server checks key shape (16 letters/digits) and reachability. Empty string = valid (no key). */
export const validateAlphaVantageApiKey = async (
  apiKey: string,
): Promise<AlphaVantageKeyValidateResponse> => {
  if (!apiKey.trim()) {
    return { ok: true };
  }
  const response = await apiClient.post<AlphaVantageKeyValidateResponse>(
    '/validate-alpha-vantage',
    { api_key: apiKey.trim() },
  );
  return response.data;
};

export const getTaskStatus = async (taskId: string) => {
  const response = await apiClient.get<TaskStatus>(`/task/${taskId}`);
  return response.data;
};

export const cancelTask = async (taskId: string) => {
  const response = await apiClient.delete(`/task/${taskId}`);
  return response.data;
};

export interface StoredHistoryListItem {
  task_id: string;
  ticker: string;
  analysis_date: string;
  status: string;
  created_at: string | null;
  completed_at: string | null;
  summary_preview: string;
  signal?: string | null;
}

export const listStoredHistory = async (limit = 200) => {
  const response = await apiClient.get<StoredHistoryListItem[]>('/history', {
    params: { limit },
  });
  return response.data;
};

export const getStoredHistory = async (taskId: string) => {
  const response = await apiClient.get<Record<string, unknown>>(`/history/${taskId}`);
  return response.data;
};

export const deleteStoredHistory = async (taskId: string) => {
  const response = await apiClient.delete<{ deleted: boolean }>(`/history/${taskId}`);
  return response.data;
};

/** Browser opens this URL to download server-built full history export. */
export function getProfessionalHistoryExportUrl(
  taskId: string,
  format: 'markdown' | 'pdf' | 'docx',
  options?: { enhanced?: boolean; refreshEnhancement?: boolean },
): string {
  const params = new URLSearchParams();
  params.set('format', format);
  if (options?.enhanced === false) {
    params.set('enhanced', 'false');
  }
  if (options?.refreshEnhancement) {
    params.set('refresh_enhancement', 'true');
  }
  return `/api/history/${encodeURIComponent(taskId)}/export?${params.toString()}`;
}

// Backward-compatible aliases
export type StoredReportListItem = StoredHistoryListItem;
export const listStoredReports = listStoredHistory;
export const getStoredReport = getStoredHistory;
export const deleteStoredReport = deleteStoredHistory;
export const getProfessionalReportExportUrl = getProfessionalHistoryExportUrl;