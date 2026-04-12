import { useState, useEffect, useRef } from "react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Checkbox } from "./ui/checkbox";
import { Button } from "./ui/button";
import { Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  DATA_VENDOR_KEYS,
  DATA_VENDOR_LABELS,
  DEFAULT_DATA_VENDORS,
  type DataVendorKey,
  type DataVendorValue,
  mergeDataVendors,
} from "../config/dataVendors";
import {
  TRADING_AGENTS_CONFIG_STORAGE_KEY,
  buildTradingAgentsConfigJson,
  decryptAlphaVantageKeyFromParsed,
  parseHasSealedAlphaVantageKey,
} from "../utils/tradingAgentsConfigStorage";
import { validateAlphaVantageApiKey } from "../api/client";

/** When API key is missing, Alpha Vantage cannot be used — fall back to yfinance. */
function vendorsWithoutAvIfNoKey(
  vendors: Record<DataVendorKey, DataVendorValue>,
  apiKey?: string,
): Record<DataVendorKey, DataVendorValue> {
  if (apiKey?.trim()) return vendors;
  let changed = false;
  const next = { ...vendors };
  for (const k of DATA_VENDOR_KEYS) {
    if (next[k] === "alpha_vantage") {
      next[k] = "yfinance";
      changed = true;
    }
  }
  return changed ? next : vendors;
}

function dataProvidersUseAlphaVantage(
  vendors: Record<DataVendorKey, DataVendorValue>,
): boolean {
  return DATA_VENDOR_KEYS.some((k) => vendors[k] === "alpha_vantage");
}

interface ConfigData {
  outputLanguage: string;
  analysts: string[];
  researchDepth: string;
  llmProvider: string;
  alphaVantageApiKey?: string;
  dataVendors: Record<DataVendorKey, DataVendorValue>;
}

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  quickThinkModel: string;
  deepThinkModel: string;
}

const DEFAULT_CONFIG: ConfigData = {
  outputLanguage: "english",
  analysts: ["market", "social"],
  researchDepth: "shallow",
  llmProvider: "volcengine-default",
  alphaVantageApiKey: "GW5UFA3PTRVKGS9J",
  dataVendors: { ...DEFAULT_DATA_VENDORS },
};

const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: "volcengine-default",
    name: "VolcEngine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: "d0c755e2-d31b-44e4-a08d-73508818f750",
    quickThinkModel: "deepseek-v3-1-terminus",
    deepThinkModel: "deepseek-v3-1-terminus",
  },
];

function readInitialConfigWhenNoSavedBlob(): ConfigData {
  return {
    ...DEFAULT_CONFIG,
    alphaVantageApiKey: "",
    dataVendors: vendorsWithoutAvIfNoKey({ ...DEFAULT_DATA_VENDORS }, ""),
  };
}

function readInitialConfigSync(): ConfigData {
  const saved = localStorage.getItem(TRADING_AGENTS_CONFIG_STORAGE_KEY);
  if (!saved) {
    return readInitialConfigWhenNoSavedBlob();
  }
  try {
    const parsed = JSON.parse(saved) as Record<string, unknown>;
    if (parseHasSealedAlphaVantageKey(parsed)) {
      return {
        ...DEFAULT_CONFIG,
        alphaVantageApiKey: "",
        dataVendors: vendorsWithoutAvIfNoKey(
          mergeDataVendors(parsed.dataVendors as ConfigData["dataVendors"]),
          "",
        ),
      };
    }
    const legacy =
      typeof parsed.alphaVantageApiKey === "string" && parsed.alphaVantageApiKey.trim()
        ? parsed.alphaVantageApiKey.trim()
        : "";
    const { alphaVantageApiKey: _omitAv, alphaVantageApiKeySealed: _omitSealed, ...rest } =
      parsed;
    return {
      ...DEFAULT_CONFIG,
      ...(rest as Partial<ConfigData>),
      alphaVantageApiKey: legacy,
      dataVendors: vendorsWithoutAvIfNoKey(
        mergeDataVendors(parsed.dataVendors as ConfigData["dataVendors"]),
        legacy,
      ),
    };
  } catch {
    return readInitialConfigWhenNoSavedBlob();
  }
}

export function SettingsPage() {
  const [config, setConfig] = useState<ConfigData>(() => readInitialConfigSync());

  const [settingsReady, setSettingsReady] = useState(() => {
    const raw = localStorage.getItem(TRADING_AGENTS_CONFIG_STORAGE_KEY);
    if (raw === null) return true;
    try {
      return !parseHasSealedAlphaVantageKey(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      return true;
    }
  });

  const [providers, setProviders] = useState<Provider[]>([]);

  useEffect(() => {
    const savedProviders = localStorage.getItem('tradingagents-providers');
    if (savedProviders) {
      try {
        const parsed = JSON.parse(savedProviders);
        setProviders(parsed);
      } catch (e) {
        console.error('Failed to load providers:', e);
      }
    } else {
      // Initialize with default providers if none saved
      setProviders(DEFAULT_PROVIDERS);
      localStorage.setItem('tradingagents-providers', JSON.stringify(DEFAULT_PROVIDERS));
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(TRADING_AGENTS_CONFIG_STORAGE_KEY);
    if (saved === null) return;
    void (async () => {
      try {
        const parsed = JSON.parse(saved) as Record<string, unknown>;
        const avKey = await decryptAlphaVantageKeyFromParsed(parsed);
        const { alphaVantageApiKey: _omitAv2, alphaVantageApiKeySealed: _omitSealed2, ...rest } =
          parsed;
        const mergedBase = { ...DEFAULT_CONFIG, ...(rest as Partial<ConfigData>) };
        setConfig({
          ...mergedBase,
          alphaVantageApiKey: avKey ?? "",
          dataVendors: vendorsWithoutAvIfNoKey(
            mergeDataVendors(parsed.dataVendors as ConfigData["dataVendors"]),
            avKey,
          ),
        });
      } catch (e) {
        console.error("Failed to load tradingagents config:", e);
      } finally {
        setSettingsReady(true);
      }
    })();
  }, []);

  const PERSIST_DEBOUNCE_MS = 650;
  const persistAvFailToastRef = useRef<string | null>(null);

  useEffect(() => {
    if (!settingsReady) return;
    const handle = window.setTimeout(() => {
      void (async () => {
        const trimmed = config.alphaVantageApiKey?.trim();
        const needsAvKey = dataProvidersUseAlphaVantage(config.dataVendors);
        if (needsAvKey) {
          if (!trimmed) {
            if (persistAvFailToastRef.current !== "__av_key_required__") {
              persistAvFailToastRef.current = "__av_key_required__";
              toast.error(
                "Cannot save — set an Alpha Vantage API key when any data source uses Alpha Vantage",
              );
            }
            return;
          }
          try {
            const r = await validateAlphaVantageApiKey(trimmed);
            if (!r.ok) {
              const msg = r.message || "Alpha Vantage API key is invalid";
              const sig = `${trimmed}:${msg}`;
              if (persistAvFailToastRef.current !== sig) {
                persistAvFailToastRef.current = sig;
                toast.error("Cannot save — " + msg);
              }
              return;
            }
          } catch {
            if (persistAvFailToastRef.current !== "__network__") {
              persistAvFailToastRef.current = "__network__";
              toast.error(
                "Cannot save — could not verify API key (check backend / network)",
              );
            }
            return;
          }
        }
        persistAvFailToastRef.current = null;
        try {
          const json = await buildTradingAgentsConfigJson(config);
          localStorage.setItem(TRADING_AGENTS_CONFIG_STORAGE_KEY, json);
        } catch (e) {
          console.error(e);
        }
      })();
    }, PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [config, settingsReady]);

  useEffect(() => {
    if (config.alphaVantageApiKey?.trim()) return;
    setConfig((prev) => {
      const nextVendors = vendorsWithoutAvIfNoKey(prev.dataVendors, "");
      if (nextVendors === prev.dataVendors) return prev;
      return { ...prev, dataVendors: nextVendors };
    });
  }, [config.alphaVantageApiKey]);

  const alphaVantageKeyReady = Boolean(config.alphaVantageApiKey?.trim());

  const [isSaving, setIsSaving] = useState(false);

  const toggleAnalyst = (analyst: string) => {
    setConfig(prev => ({
      ...prev,
      analysts: prev.analysts.includes(analyst)
        ? prev.analysts.filter(a => a !== analyst)
        : [...prev.analysts, analyst]
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const trimmed = config.alphaVantageApiKey?.trim();
      const needsAvKey = dataProvidersUseAlphaVantage(config.dataVendors);
      if (needsAvKey) {
        if (!trimmed) {
          toast.error(
            "Enter an Alpha Vantage API key when any data source uses Alpha Vantage",
          );
          return;
        }
        try {
          const r = await validateAlphaVantageApiKey(trimmed);
          if (!r.ok) {
            toast.error(r.message || "Alpha Vantage API key is invalid");
            return;
          }
        } catch {
          toast.error("Could not verify API key — check that the backend is running");
          return;
        }
      }
      const json = await buildTradingAgentsConfigJson(config);
      localStorage.setItem(TRADING_AGENTS_CONFIG_STORAGE_KEY, json);
      persistAvFailToastRef.current = null;
      toast.success("Settings saved successfully!");
    } catch (e) {
      console.error(e);
      toast.error("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    const next: ConfigData = {
      ...DEFAULT_CONFIG,
      analysts: [...DEFAULT_CONFIG.analysts],
      dataVendors: { ...DEFAULT_DATA_VENDORS },
    };
    void (async () => {
      const trimmed = next.alphaVantageApiKey?.trim();
      if (dataProvidersUseAlphaVantage(next.dataVendors)) {
        if (!trimmed) {
          toast.error(
            "Add an Alpha Vantage API key — at least one default data source uses Alpha Vantage",
          );
          return;
        }
        try {
          const r = await validateAlphaVantageApiKey(trimmed);
          if (!r.ok) {
            toast.error(
              r.message ||
                "Default Alpha Vantage key failed validation; reset not applied",
            );
            return;
          }
        } catch {
          toast.error("Could not verify default API key; reset not applied");
          return;
        }
      }
      setConfig(next);
      try {
        const json = await buildTradingAgentsConfigJson(next);
        localStorage.setItem(TRADING_AGENTS_CONFIG_STORAGE_KEY, json);
        persistAvFailToastRef.current = null;
        toast.success("Settings reset to defaults");
      } catch (e) {
        console.error(e);
        toast.error("Failed to persist reset settings");
      }
    })();
  };

  if (!settingsReady) {
    return (
      <div className="max-w-5xl mx-auto flex min-h-[200px] items-center justify-center text-sm text-[#8b949e]">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      
      {/* Compact Header */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl text-[#e6edf3] font-semibold">Configuration Settings</h1>
            <p className="text-xs text-[#8b949e] mt-0.5">Configure trading analysis parameters</p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#0d1117] rounded border border-[#30363d] text-xs">
            <div className="w-1.5 h-1.5 bg-[#3fb950] rounded-full animate-pulse"></div>
            <span className="text-[#8b949e]">
              Auto-save (API key encrypted with salt in browser)
            </span>
          </div>
        </div>
      </div>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Step 1: Output Language */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <div className="mb-3">
            <h2 className="text-sm text-[#e6edf3] font-semibold flex items-center gap-2">
              <span className="text-[#ffa657] font-mono">1.</span> Output Language
            </h2>
            <p className="text-[10px] text-[#6e7681] mt-0.5">Language for reports and decisions</p>
          </div>
          <RadioGroup value={config.outputLanguage} onValueChange={(value) => setConfig({ ...config, outputLanguage: value })}>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="english" id="english" className="border-[#484f58] text-[#f85149]" />
                <Label htmlFor="english" className="text-[#8b949e] cursor-pointer text-xs">English</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="chinese" id="chinese" className="border-[#484f58] text-[#f85149]" />
                <Label htmlFor="chinese" className="text-[#8b949e] cursor-pointer text-xs">Chinese</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="spanish" id="spanish" className="border-[#484f58] text-[#f85149]" />
                <Label htmlFor="spanish" className="text-[#8b949e] cursor-pointer text-xs">Spanish (Español)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="japanese" id="japanese" className="border-[#484f58] text-[#f85149]" />
                <Label htmlFor="japanese" className="text-[#8b949e] cursor-pointer text-xs">Japanese</Label>
              </div>
            </div>
          </RadioGroup>
        </div>

        {/* Step 2: Analysts Team */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <div className="mb-3">
            <h2 className="text-sm text-[#e6edf3] font-semibold flex items-center gap-2">
              <span className="text-[#ffa657] font-mono">2.</span> Analysts Team
            </h2>
            <p className="text-[10px] text-[#6e7681] mt-0.5">Select analyst agents</p>
          </div>
          <div className="space-y-2">
            {['market', 'social', 'news', 'fundamentals'].map((analyst) => (
              <div key={analyst} className="flex items-center space-x-2">
                <Checkbox
                  id={analyst}
                  checked={config.analysts.includes(analyst)}
                  onCheckedChange={() => toggleAnalyst(analyst)}
                  className="border-[#484f58] data-[state=checked]:bg-[#f85149] data-[state=checked]:text-white"
                />
                <Label htmlFor={analyst} className="text-[#8b949e] cursor-pointer capitalize text-xs">
                  {analyst} Analyst
                </Label>
              </div>
            ))}
          </div>
        </div>

        {/* Step 3: Research Depth */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <div className="mb-3">
            <h2 className="text-sm text-[#e6edf3] font-semibold flex items-center gap-2">
              <span className="text-[#ffa657] font-mono">3.</span> Research Depth
            </h2>
            <p className="text-[10px] text-[#6e7681] mt-0.5">Analysis depth level</p>
          </div>
          <RadioGroup value={config.researchDepth} onValueChange={(value) => setConfig({ ...config, researchDepth: value })}>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="shallow" id="shallow" className="border-[#484f58] text-[#f85149]" />
                <Label htmlFor="shallow" className="text-[#8b949e] cursor-pointer text-xs">
                  Shallow - Quick research
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="medium" id="medium" className="border-[#484f58] text-[#f85149]" />
                <Label htmlFor="medium" className="text-[#8b949e] cursor-pointer text-xs">
                  Medium - Moderate depth
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="deep" id="deep" className="border-[#484f58] text-[#f85149]" />
                <Label htmlFor="deep" className="text-[#8b949e] cursor-pointer text-xs">
                  Deep - Comprehensive
                </Label>
              </div>
            </div>
          </RadioGroup>
        </div>

        {/* Step 4: LLM Provider */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <div className="mb-3">
            <h2 className="text-sm text-[#e6edf3] font-semibold flex items-center gap-2">
              <span className="text-[#ffa657] font-mono">4.</span> LLM Provider
            </h2>
            <p className="text-[10px] text-[#6e7681] mt-0.5">Select your LLM provider</p>
          </div>
          {providers.length === 0 ? (
            <div className="text-xs text-[#ffa657] bg-[#ffa657]/5 border border-[#ffa657]/20 rounded p-3">
              ⚠ No providers configured. Add providers in the Provider page first.
            </div>
          ) : (
            <Select
              value={config.llmProvider}
              onValueChange={(value) => setConfig({ ...config, llmProvider: value })}
            >
              <SelectTrigger className="border-[#30363d] text-[#8b949e] bg-[#0d1117] h-9 text-xs">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent className="border-[#30363d] bg-[#161b22]">
                {providers.map(provider => (
                  <SelectItem 
                    key={provider.id} 
                    value={provider.id}
                    className="text-[#8b949e] text-xs focus:bg-[#1c2128] focus:text-[#e6edf3]"
                  >
                    {provider.name} {!provider.apiKey && <span className="text-[#ffa657] ml-2">⚠</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Step 5: Alpha Vantage API Key */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 lg:col-span-2">
          <div className="mb-3">
            <h2 className="text-sm text-[#e6edf3] font-semibold flex items-center gap-2">
              <span className="text-[#ffa657] font-mono">5.</span> Alpha Vantage API Key
            </h2>
            <p className="text-[10px] text-[#6e7681] mt-0.5">API key for market data access</p>
          </div>
          <div className="space-y-2 max-w-xl">
            <Label htmlFor="alpha-vantage-key" className="text-[#8b949e] text-xs font-medium">
              API Key
            </Label>
            <Input
              id="alpha-vantage-key"
              type="password"
              value={config.alphaVantageApiKey || ""}
              onChange={(e) => setConfig({ ...config, alphaVantageApiKey: e.target.value })}
              placeholder="Enter your Alpha Vantage API key"
              className="bg-[#0d1117] border-[#30363d] text-[#e6edf3] placeholder:text-[#6e7681] h-9 text-sm focus:border-[#f85149]"
            />
            <p className="text-[10px] text-[#6e7681] mt-1">
              Leave empty if every data source below uses yfinance. When any source uses Alpha Vantage,
              keys are{" "}
              <span className="text-[#8b949e]">16 letters or digits</span> (no spaces). Saving runs a
              format check only in that case. Get a key at{" "}
              <a
                href="https://www.alphavantage.co/support/#api-key"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#58a6ff] hover:text-[#79c0ff] underline"
              >
                alphavantage.co
              </a>
              .
            </p>
          </div>
        </div>

        {/* Step 6: Data vendors (per-category) */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 lg:col-span-2">
          <div className="mb-3">
            <h2 className="text-sm text-[#e6edf3] font-semibold flex items-center gap-2">
              <span className="text-[#ffa657] font-mono">6.</span> Data vendors
            </h2>
            <p className="text-[10px] text-[#6e7681] mt-0.5">
              Choose yfinance or Alpha Vantage per data category (matches backend{" "}
              <span className="font-mono text-[#8b949e]">data_vendors</span>)
            </p>
            {!alphaVantageKeyReady && (
              <p className="text-[10px] text-[#ffa657] mt-1.5">
                Enter an Alpha Vantage API key in step 5 to enable Alpha Vantage here.
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl">
            {DATA_VENDOR_KEYS.map((key) => (
              <div key={key} className="space-y-1.5">
                <Label className="text-[#8b949e] text-xs font-medium">
                  {DATA_VENDOR_LABELS[key]}
                </Label>
                <Select
                  value={config.dataVendors[key]}
                  onValueChange={(value) =>
                    setConfig({
                      ...config,
                      dataVendors: {
                        ...config.dataVendors,
                        [key]: value as DataVendorValue,
                      },
                    })
                  }
                >
                  <SelectTrigger className="border-[#30363d] text-[#8b949e] bg-[#0d1117] h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-[#30363d] bg-[#161b22]">
                    <SelectItem
                      value="yfinance"
                      className="text-[#8b949e] text-xs focus:bg-[#1c2128] focus:text-[#e6edf3]"
                    >
                      yfinance
                    </SelectItem>
                    <SelectItem
                      value="alpha_vantage"
                      disabled={!alphaVantageKeyReady}
                      className="text-[#8b949e] text-xs focus:bg-[#1c2128] focus:text-[#e6edf3]"
                    >
                      Alpha Vantage
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-2 pb-6">
        <Button
          onClick={handleReset}
          variant="outline"
          className="border-[#30363d] text-[#8b949e] hover:bg-[#161b22] hover:text-[#e6edf3] h-9 text-sm"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
          Reset to Defaults
        </Button>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-[#f85149] hover:bg-[#ff6b6b] text-white h-9 text-sm font-medium border-0 disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5 mr-1.5" />
          Save Settings
        </Button>
      </div>
    </div>
  );
}