import { useState, useEffect, useCallback } from "react";
import { BarChart3, TrendingUp, Activity, DollarSign, Clock } from "lucide-react";
import {
  PROVIDERS_STORAGE_KEY,
  PROVIDERS_UPDATED_EVENT,
} from "../utils/providerUsageStorage";

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  quickThinkModel: string;
  deepThinkModel: string;
  stats?: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    requestCount: number;
    lastUsed?: string;
  };
}

export function StatsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);

  const loadProviders = useCallback(() => {
    const saved = localStorage.getItem(PROVIDERS_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setProviders(parsed);
      } catch (e) {
        console.error("Failed to load providers:", e);
      }
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    const onUpdate = () => loadProviders();
    window.addEventListener(PROVIDERS_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(PROVIDERS_UPDATED_EVENT, onUpdate);
  }, [loadProviders]);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    return num.toString();
  };

  const getTotalStats = () => {
    return providers.reduce((acc, provider) => {
      if (provider.stats) {
        acc.totalTokens += provider.stats.totalTokens;
        acc.inputTokens += provider.stats.inputTokens;
        acc.outputTokens += provider.stats.outputTokens;
        acc.requestCount += provider.stats.requestCount;
      }
      return acc;
    }, { totalTokens: 0, inputTokens: 0, outputTokens: 0, requestCount: 0 });
  };

  const getActiveProviders = () => {
    return providers.filter(
      (p) =>
        p.stats &&
        (p.stats.requestCount > 0 || p.stats.totalTokens > 0),
    );
  };

  const getMostUsedProvider = () => {
    const activeProviders = getActiveProviders();
    if (activeProviders.length === 0) return null;
    return activeProviders.reduce((max, p) => 
      (p.stats!.totalTokens > (max.stats?.totalTokens || 0)) ? p : max
    );
  };

  const totalStats = getTotalStats();
  const activeProviders = getActiveProviders();
  const mostUsedProvider = getMostUsedProvider();

  // Calculate max tokens for bar chart scaling
  const maxTokens = Math.max(...providers.map(p => p.stats?.totalTokens || 0), 1);

  return (
    <div className="max-w-7xl mx-auto space-y-4 pb-6">
      
      {/* Compact Header */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
        <h1 className="text-xl text-[#e6edf3] font-semibold flex items-center gap-2.5">
          <BarChart3 className="w-6 h-6 text-[#f85149]" />
          Token Usage Statistics
        </h1>
        <p className="text-xs text-[#8b949e] mt-0.5">Overview of LLM provider token consumption</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs text-[#6e7681] font-medium">Total Tokens</h3>
            <TrendingUp className="w-4 h-4 text-[#f85149]" />
          </div>
          <p className="text-2xl font-bold text-[#f85149]">
            {formatNumber(totalStats.totalTokens)}
          </p>
          <p className="text-[10px] text-[#6e7681] mt-1">
            Across all providers
          </p>
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs text-[#6e7681] font-medium">Total Requests</h3>
            <Activity className="w-4 h-4 text-[#f85149]" />
          </div>
          <p className="text-2xl font-bold text-[#f85149]">
            {totalStats.requestCount}
          </p>
          <p className="text-[10px] text-[#6e7681] mt-1">
            API calls made
          </p>
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs text-[#6e7681] font-medium">Active Providers</h3>
            <Clock className="w-4 h-4 text-[#ffa657]" />
          </div>
          <p className="text-2xl font-bold text-[#ffa657]">
            {activeProviders.length}
          </p>
          <p className="text-[10px] text-[#6e7681] mt-1">
            Out of {providers.length} configured
          </p>
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs text-[#6e7681] font-medium">Avg. Tokens/Request</h3>
            <DollarSign className="w-4 h-4 text-[#ffa657]" />
          </div>
          <p className="text-2xl font-bold text-[#ffa657]">
            {totalStats.requestCount > 0 
              ? formatNumber(Math.floor(totalStats.totalTokens / totalStats.requestCount))
              : '0'}
          </p>
          <p className="text-[10px] text-[#6e7681] mt-1">
            Average per API call
          </p>
        </div>
      </div>

      {/* Most Used Provider */}
      {mostUsedProvider && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <h2 className="text-sm text-[#e6edf3] font-semibold flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-[#f85149]" />
            Most Used Provider
          </h2>
          <div className="bg-[#f85149]/5 border border-[#f85149]/20 rounded p-3">
            <div className="flex items-center justify-between mb-2.5">
              <div>
                <h3 className="text-base font-semibold text-[#e6edf3]">{mostUsedProvider.name}</h3>
                <p className="text-xs text-[#6e7681]">{mostUsedProvider.baseUrl}</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold text-[#f85149]">
                  {formatNumber(mostUsedProvider.stats!.totalTokens)}
                </p>
                <p className="text-[10px] text-[#6e7681]">tokens</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2.5 text-xs">
              <div>
                <p className="text-[#6e7681]">Input</p>
                <p className="text-[#ffa657] font-semibold">{formatNumber(mostUsedProvider.stats!.inputTokens)}</p>
              </div>
              <div>
                <p className="text-[#6e7681]">Output</p>
                <p className="text-[#ffa657] font-semibold">{formatNumber(mostUsedProvider.stats!.outputTokens)}</p>
              </div>
              <div>
                <p className="text-[#6e7681]">Requests</p>
                <p className="text-[#f85149] font-semibold">{mostUsedProvider.stats!.requestCount}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Provider Comparison */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
        <h2 className="text-sm text-[#e6edf3] font-semibold mb-3">Provider Comparison</h2>
        {providers.length === 0 ? (
          <div className="text-center py-8 text-[#6e7681] text-xs">
            <p>No providers configured yet</p>
          </div>
        ) : activeProviders.length === 0 ? (
          <div className="text-center py-8 text-[#6e7681] text-xs">
            <p>No usage data yet. Run an analysis to start tracking token usage.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((provider) => {
              const hasStats = provider.stats && provider.stats.requestCount > 0;
              const percentage = hasStats ? (provider.stats!.totalTokens / maxTokens) * 100 : 0;
              
              return (
                <div key={provider.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex-1">
                      <span className="text-[#e6edf3] font-semibold">{provider.name}</span>
                      {hasStats && (
                        <span className="text-[#6e7681] ml-2 text-[10px]">
                          ({formatNumber(provider.stats!.totalTokens)} tokens)
                        </span>
                      )}
                    </div>
                    {hasStats && (
                      <div className="text-right text-[10px] text-[#6e7681]">
                        <span>{provider.stats!.requestCount} requests</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="w-full bg-[#0d1117] rounded-full h-2 border border-[#30363d]">
                    <div
                      className="bg-gradient-to-r from-[#f85149] to-[#ffa657] h-full rounded-full transition-all duration-500 flex items-center justify-end"
                      style={{ width: `${percentage}%` }}
                    >
                      {percentage > 20 && (
                        <span className="text-[9px] font-semibold text-white pr-1.5">
                          {percentage.toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Token Breakdown */}
                  {hasStats && (
                    <div className="flex gap-3 text-[10px] text-[#6e7681] pl-1">
                      <span>In: {formatNumber(provider.stats!.inputTokens)}</span>
                      <span>Out: {formatNumber(provider.stats!.outputTokens)}</span>
                      {provider.stats!.lastUsed && (
                        <span>Last: {new Date(provider.stats!.lastUsed).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      )}
                    </div>
                  )}

                  {!hasStats && (
                    <p className="text-[10px] text-[#6e7681] pl-1">No usage data</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Input/Output Ratio */}
      {totalStats.totalTokens > 0 && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <h2 className="text-sm text-[#e6edf3] font-semibold mb-3">Input vs Output Tokens</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-[#8b949e]">Input Tokens</span>
                <span className="text-sm text-[#ffa657] font-semibold">
                  {formatNumber(totalStats.inputTokens)}
                </span>
              </div>
              <div className="w-full bg-[#0d1117] rounded-full h-3 border border-[#30363d]">
                <div
                  className="bg-gradient-to-r from-[#ffa657] to-[#ffb86c] h-full rounded-full"
                  style={{ width: `${(totalStats.inputTokens / totalStats.totalTokens) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-[#6e7681] mt-1">
                {((totalStats.inputTokens / totalStats.totalTokens) * 100).toFixed(1)}% of total
              </p>
            </div>
            
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-[#8b949e]">Output Tokens</span>
                <span className="text-sm text-[#f85149] font-semibold">
                  {formatNumber(totalStats.outputTokens)}
                </span>
              </div>
              <div className="w-full bg-[#0d1117] rounded-full h-3 border border-[#30363d]">
                <div
                  className="bg-gradient-to-r from-[#f85149] to-[#ff6b6b] h-full rounded-full"
                  style={{ width: `${(totalStats.outputTokens / totalStats.totalTokens) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-[#6e7681] mt-1">
                {((totalStats.outputTokens / totalStats.totalTokens) * 100).toFixed(1)}% of total
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}