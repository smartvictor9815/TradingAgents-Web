export const PROVIDERS_STORAGE_KEY = "tradingagents-providers";

export const PROVIDERS_UPDATED_EVENT = "tradingagents-providers-updated";

export function applyProviderUsageDelta(
  providerId: string,
  delta: { inputTokens: number; outputTokens: number; llmCalls: number },
) {
  const { inputTokens, outputTokens, llmCalls } = delta;
  if (inputTokens <= 0 && outputTokens <= 0 && llmCalls <= 0) return;

  const raw = localStorage.getItem(PROVIDERS_STORAGE_KEY);
  if (!raw) return;

  try {
    const providers = JSON.parse(raw) as Array<Record<string, unknown>>;
    const next = providers.map((p) => {
      if (p.id !== providerId) return p;
      const prev = (p.stats as Record<string, number> | undefined) || {};
      const inputTokens0 = Number(prev.inputTokens) || 0;
      const outputTokens0 = Number(prev.outputTokens) || 0;
      const requestCount0 = Number(prev.requestCount) || 0;
      const totalTokens0 = Number(prev.totalTokens) || inputTokens0 + outputTokens0;
      return {
        ...p,
        stats: {
          totalTokens: totalTokens0 + inputTokens + outputTokens,
          inputTokens: inputTokens0 + inputTokens,
          outputTokens: outputTokens0 + outputTokens,
          requestCount: requestCount0 + llmCalls,
          lastUsed: new Date().toISOString(),
        },
      };
    });
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(PROVIDERS_UPDATED_EVENT));
  } catch {
    /* ignore corrupt storage */
  }
}
