import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Plus, Trash2, Edit2, Save, X, Loader2, CheckCircle } from "lucide-react";
import { toast } from "sonner";

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  quickThinkModel: string;
  deepThinkModel: string;
}

/** Map request.provider for /api/test-provider: id prefix is stable even if display name is localized. */
function providerSlugForApi(provider: Provider): string {
  const slug = provider.id.split("-")[0]?.toLowerCase() ?? "";
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
  if (known.has(slug)) return slug;
  return provider.name.toLowerCase();
}

const DEFAULT_PROVIDERS: Provider[] = [
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
  {
    id: "deepseek-default",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    quickThinkModel: "deepseek-chat",
    deepThinkModel: "deepseek-reasoner",
  },
  {
    id: "volcengine-default",
    name: "VolcEngine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: "",
    quickThinkModel: "deepseek-v3-2-251201",
    deepThinkModel: "deepseek-v3-2-251201",
  },
];

export function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [validatingId, setValidatingId] = useState<string | null>(null);

  const [formData, setFormData] = useState<Omit<Provider, 'id'>>({
    name: "",
    baseUrl: "",
    apiKey: "",
    quickThinkModel: "",
    deepThinkModel: "",
  });

  useEffect(() => {
    const saved = localStorage.getItem('tradingagents-providers');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setProviders(parsed);
      } catch (e) {
        console.error('Failed to load providers:', e);
        // If parsing fails, initialize with default providers
        saveProviders(DEFAULT_PROVIDERS);
      }
    } else {
      // First time initialization - load default providers
      saveProviders(DEFAULT_PROVIDERS);
    }
  }, []);

  const saveProviders = (newProviders: Provider[]) => {
    localStorage.setItem('tradingagents-providers', JSON.stringify(newProviders));
    setProviders(newProviders);
  };

  const validateProvider = async (provider: Provider): Promise<boolean> => {
    setValidatingId(provider.id);
    
    try {
      // Validate Base URL format
      try {
        new URL(provider.baseUrl);
      } catch {
        toast.error("Invalid Base URL format");
        setValidatingId(null);
        return false;
      }

      // Check if API Key is provided
      if (!provider.apiKey.trim()) {
        toast.error("API Key is required");
        setValidatingId(null);
        return false;
      }

      // Check if models are specified
      if (!provider.quickThinkModel.trim() || !provider.deepThinkModel.trim()) {
        toast.error("Both Quick-Think and Deep-Think models are required");
        setValidatingId(null);
        return false;
      }

      // Real API connection test via backend
      const testResult = await testProviderConnection(provider);
      
      if (testResult.success) {
        toast.success(`Provider "${provider.name}" validated successfully!`);
        setValidatingId(null);
        return true;
      } else {
        const err = testResult.error || "Unknown error";
        toast.error(`Failed to connect: ${err}`);
        setValidatingId(null);
        return false;
      }
    } catch (_err) {
      toast.error("Validation failed. Please try again.");
      setValidatingId(null);
      return false;
    }
  };

  // Test provider connection via backend API
  const testProviderConnection = async (provider: Provider): Promise<{success: boolean; error?: string}> => {
    try {
      const response = await fetch('/api/test-provider', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: providerSlugForApi(provider),
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.quickThinkModel,
        }),
      });

      const raw = await response.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        /* non-JSON body */
      }

      if (!response.ok) {
        const detail = typeof parsed.detail === "string" ? parsed.detail : "";
        const message = typeof parsed.message === "string" ? parsed.message : "";
        const errField = typeof parsed.error === "string" ? parsed.error : "";
        const snippet =
          !detail && !message && !errField && raw.length > 0 && raw.length < 400
            ? raw.trim()
            : "";
        const gatewayOrEmpty =
          !detail &&
          !message &&
          !errField &&
          !snippet &&
          [500, 502, 503, 504].includes(response.status);
        const gatewayHint = gatewayOrEmpty
          ? "Cannot reach the backend API at 127.0.0.1:18000. Start the server with uvicorn, e.g. .venv/bin/python -m uvicorn app.api.main:app --host 127.0.0.1 --port 18000"
          : "";
        return {
          success: false,
          error:
            detail ||
            message ||
            errField ||
            snippet ||
            gatewayHint ||
            `HTTP ${response.status}`,
        };
      }

      return {
        success: Boolean(parsed.success),
        error: typeof parsed.error === "string" ? parsed.error : undefined,
      };
    } catch {
      return { success: false, error: 'Network error - cannot connect to backend' };
    }
  };

  const handleAdd = () => {
    setIsAdding(true);
    setEditingId(null);
    setFormData({
      name: "",
      baseUrl: "",
      apiKey: "",
      quickThinkModel: "",
      deepThinkModel: "",
    });
  };

  const handleEdit = (provider: Provider) => {
    setEditingId(provider.id);
    setIsAdding(false);
    setFormData({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      quickThinkModel: provider.quickThinkModel,
      deepThinkModel: provider.deepThinkModel,
    });
  };

  const handleSave = async () => {
    // Validation
    if (!formData.name.trim()) {
      toast.error("Provider name is required");
      return;
    }
    if (!formData.baseUrl.trim()) {
      toast.error("Base URL is required");
      return;
    }
    if (!formData.apiKey.trim()) {
      toast.error("API Key is required");
      return;
    }
    if (!formData.quickThinkModel.trim()) {
      toast.error("Quick-Think Model is required");
      return;
    }
    if (!formData.deepThinkModel.trim()) {
      toast.error("Deep-Think Model is required");
      return;
    }

    const newProvider: Provider = {
      id: editingId || Date.now().toString(),
      ...formData,
    };

    // Validate connection before saving
    const isValid = await validateProvider(newProvider);
    if (!isValid) {
      return;
    }

    let newProviders: Provider[];
    if (editingId) {
      newProviders = providers.map(p => p.id === editingId ? newProvider : p);
      toast.success("Provider updated successfully!");
    } else {
      newProviders = [...providers, newProvider];
      toast.success("Provider added successfully!");
    }

    saveProviders(newProviders);
    handleCancel();
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({
      name: "",
      baseUrl: "",
      apiKey: "",
      quickThinkModel: "",
      deepThinkModel: "",
    });
  };

  const handleDelete = (id: string) => {
    const provider = providers.find(p => p.id === id);
    if (provider && confirm(`Are you sure you want to delete provider "${provider.name}"?`)) {
      const newProviders = providers.filter(p => p.id !== id);
      saveProviders(newProviders);
      toast.success("Provider deleted successfully!");
    }
  };

  const handleTestConnection = async (provider: Provider) => {
    await validateProvider(provider);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      
      {/* Compact Header */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl text-[#e6edf3] font-semibold">LLM Provider</h1>
            <p className="text-xs text-[#8b949e] mt-0.5">Manage your LLM provider configurations</p>
          </div>
          {!isAdding && !editingId && (
            <Button
              onClick={handleAdd}
              className="bg-[#f85149] hover:bg-[#ff6b6b] text-white h-9 text-sm font-medium border-0"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add Provider
            </Button>
          )}
        </div>
      </div>

      {/* Add/Edit Form */}
      {(isAdding || editingId) && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
          <h2 className="text-sm text-[#e6edf3] font-semibold mb-3 border-b border-[#30363d] pb-2">
            {editingId ? "Edit Provider" : "Add New Provider"}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="provider-name" className="text-[#8b949e] mb-1.5 block text-xs font-medium">
                Provider Name *
              </Label>
              <Input
                id="provider-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., OpenAI, Anthropic, VolcEngine"
                className="bg-[#0d1117] border-[#30363d] text-[#e6edf3] placeholder:text-[#6e7681] h-9 text-sm focus:border-[#f85149]"
              />
            </div>

            <div>
              <Label htmlFor="base-url" className="text-[#8b949e] mb-1.5 block text-xs font-medium">
                Base URL *
              </Label>
              <Input
                id="base-url"
                value={formData.baseUrl}
                onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                placeholder="https://api.provider.com/v1"
                className="bg-[#0d1117] border-[#30363d] text-[#e6edf3] placeholder:text-[#6e7681] h-9 text-sm focus:border-[#f85149]"
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="api-key" className="text-[#8b949e] mb-1.5 block text-xs font-medium">
                API Key *
              </Label>
              <Input
                id="api-key"
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder="sk-..."
                className="bg-[#0d1117] border-[#30363d] text-[#e6edf3] placeholder:text-[#6e7681] h-9 text-sm focus:border-[#f85149]"
              />
            </div>

            <div>
              <Label htmlFor="quick-think-model" className="text-[#8b949e] mb-1.5 block text-xs font-medium">
                Quick-Think Model *
              </Label>
              <Input
                id="quick-think-model"
                value={formData.quickThinkModel}
                onChange={(e) => setFormData({ ...formData, quickThinkModel: e.target.value })}
                placeholder="e.g., gpt-4o-mini, deepseek-v3"
                className="bg-[#0d1117] border-[#30363d] text-[#e6edf3] placeholder:text-[#6e7681] h-9 text-sm focus:border-[#f85149]"
              />
            </div>

            <div>
              <Label htmlFor="deep-think-model" className="text-[#8b949e] mb-1.5 block text-xs font-medium">
                Deep-Think Model *
              </Label>
              <Input
                id="deep-think-model"
                value={formData.deepThinkModel}
                onChange={(e) => setFormData({ ...formData, deepThinkModel: e.target.value })}
                placeholder="e.g., o1, deepseek-r1"
                className="bg-[#0d1117] border-[#30363d] text-[#e6edf3] placeholder:text-[#6e7681] h-9 text-sm focus:border-[#f85149]"
              />
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <Button
              onClick={handleSave}
              className="bg-[#f85149] hover:bg-[#ff6b6b] text-white h-9 text-sm font-medium border-0"
              disabled={validatingId !== null}
            >
              {validatingId ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Validating...
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  Save & Validate
                </>
              )}
            </Button>
            <Button
              onClick={handleCancel}
              variant="outline"
              className="border-[#30363d] text-[#8b949e] hover:bg-[#161b22] hover:text-[#e6edf3] h-9 text-sm"
              disabled={validatingId !== null}
            >
              <X className="w-3.5 h-3.5 mr-1.5" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Providers List */}
      {providers.length === 0 && !isAdding && !editingId ? (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-12 text-center">
          <p className="text-[#6e7681] mb-4 text-sm">No providers configured yet</p>
          <Button
            onClick={handleAdd}
            className="bg-[#f85149] hover:bg-[#ff6b6b] text-white h-9 text-sm font-medium border-0"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Your First Provider
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="bg-[#161b22] border border-[#30363d] rounded-lg p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-sm text-[#e6edf3] font-semibold mb-0.5">
                    {provider.name}
                  </h3>
                  <p className="text-xs text-[#6e7681]">{provider.baseUrl}</p>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    onClick={() => handleTestConnection(provider)}
                    variant="outline"
                    size="sm"
                    className="border-[#30363d] text-[#ffa657] hover:bg-[#ffa657]/10 h-8 text-xs px-2.5"
                    disabled={validatingId === provider.id}
                  >
                    {validatingId === provider.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle className="w-3.5 h-3.5 mr-1" />
                        Test
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => handleEdit(provider)}
                    variant="outline"
                    size="sm"
                    className="border-[#30363d] text-[#8b949e] hover:bg-[#161b22] hover:text-[#e6edf3] h-8 px-2.5"
                    disabled={validatingId !== null}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    onClick={() => handleDelete(provider.id)}
                    variant="outline"
                    size="sm"
                    className="border-[#30363d] text-[#3fb950] hover:bg-[#3fb950]/10 h-8 px-2.5"
                    disabled={validatingId !== null}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs mb-3">
                <div>
                  <p className="text-[#6e7681] mb-0.5">API Key</p>
                  <p className="text-[#8b949e] font-mono text-[10px]">
                    {provider.apiKey ? 
                      `${provider.apiKey.substring(0, 8)}...${provider.apiKey.substring(provider.apiKey.length - 4)}` : 
                      <span className="text-[#ffa657]">⚠ Not configured</span>
                    }
                  </p>
                </div>
                <div>
                  <p className="text-[#6e7681] mb-0.5">Quick-Think Model</p>
                  <p className="text-[#8b949e]">{provider.quickThinkModel}</p>
                </div>
                <div>
                  <p className="text-[#6e7681] mb-0.5">Deep-Think Model</p>
                  <p className="text-[#8b949e]">{provider.deepThinkModel}</p>
                </div>
              </div>


            </div>
          ))}
        </div>
      )}
    </div>
  );
}