/**
 * Single source of truth for initial LLM provider rows (localStorage seed).
 * Keep in sync with backend provider keys in app/api/main.py (PROVIDER_ID_MAP).
 */
export interface LlmProviderDefaults {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  quickThinkModel: string;
  deepThinkModel: string;
}

export const DEFAULT_LLM_PROVIDERS: LlmProviderDefaults[] = [
  {
    id: "volcengine-default",
    name: "VolcEngine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: "",
    quickThinkModel: "deepseek-v3-1-terminus",
    deepThinkModel: "deepseek-v3-1-terminus",
  },
  {
    id: "deepseek-default",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    quickThinkModel: "deepseek-chat",
    deepThinkModel: "deepseek-reasoner",
  },
  {
    id: "openai-default",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    quickThinkModel: "gpt-4o-mini",
    deepThinkModel: "o1",
  },
  {
    id: "anthropic-default",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "",
    quickThinkModel: "claude-3-5-haiku-20241022",
    deepThinkModel: "claude-3-7-sonnet-20250219",
  },
  {
    id: "google-default",
    name: "Google",
    baseUrl: "https://generativelanguage.googleapis.com/v1",
    apiKey: "",
    quickThinkModel: "gemini-2.0-flash-exp",
    deepThinkModel: "gemini-2.0-flash-thinking-exp",
  },
];
