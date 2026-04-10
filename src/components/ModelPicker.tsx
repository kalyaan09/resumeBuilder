import { useState } from "react";

interface ProviderField {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  options?: { value: string; label: string; note?: string }[];
}

const PROVIDERS: Array<{
  id: string;
  name: string;
  description: string;
  fields: ProviderField[];
  defaultValues: Record<string, string>;
}> = [
  {
    id: "ollama",
    name: "Ollama (Local)",
    description: "Free, runs on device",
    fields: [
      { key: "model", label: "Model Name", placeholder: "e.g. gemma4:27b" },
      { key: "base_url", label: "Base URL", placeholder: "http://localhost:11434" },
    ],
    defaultValues: { base_url: "http://localhost:11434", model: "llama3.2" },
  },
  {
    id: "gemini",
    name: "Google Gemini",
    description: "Free tier available — no credit card required",
    fields: [
      { key: "api_key", label: "API Key", placeholder: "AIza...", secret: true },
      {
        key: "model",
        label: "Model",
        placeholder: "gemini-2.5-flash",
        options: [
          { value: "gemini-2.5-flash", label: "gemini-2.5-flash", note: "Best reasoning · ~10 RPM / 250 RPD" },
          { value: "gemini-2.5-flash-lite-preview-06-17", label: "gemini-2.5-flash-lite-preview-06-17", note: "Fastest & cheapest · ~30 RPM / 1,500 RPD" },
          { value: "gemini-1.5-flash", label: "gemini-1.5-flash", note: "Max free quota · ~15 RPM / 1,500 RPD" },
        ],
      },
    ],
    defaultValues: { model: "gemini-2.5-flash" },
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    description: "Most capable",
    fields: [
      { key: "api_key", label: "API Key", placeholder: "sk-ant-...", secret: true },
      { key: "model", label: "Model", placeholder: "claude-opus-4-20250514" },
    ],
    defaultValues: { model: "claude-opus-4-20250514" },
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT models",
    fields: [
      { key: "api_key", label: "API Key", placeholder: "sk-...", secret: true },
      { key: "model", label: "Model", placeholder: "gpt-4.1" },
    ],
    defaultValues: { model: "gpt-4.1" },
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Access 100+ models",
    fields: [
      { key: "api_key", label: "API Key", placeholder: "sk-or-...", secret: true },
      { key: "model", label: "Model String", placeholder: "meta-llama/llama-3.1-70b-instruct" },
    ],
    defaultValues: {},
  },
  {
    id: "groq",
    name: "Groq",
    description: "Free tier, ultra-fast",
    fields: [
      { key: "api_key", label: "API Key", placeholder: "gsk_...", secret: true },
      { key: "model", label: "Model", placeholder: "llama-3.3-70b-versatile" },
    ],
    defaultValues: { model: "llama-3.3-70b-versatile" },
  },
];

interface ModelConfig {
  provider: string;
  [key: string]: string;
}

interface ModelPickerProps {
  value: ModelConfig | null;
  /** The API key for the currently selected provider, kept outside modelConfig */
  apiKey: string;
  onChange: (config: ModelConfig) => void;
  onApiKeyChange: (key: string) => void;
  /** Called when a test connection succeeds — use to mark the model as verified */
  onTestSuccess?: () => void;
}

export default function ModelPicker({ value, apiKey, onChange, onApiKeyChange, onTestSuccess }: ModelPickerProps) {
  const [testStatus, setTestStatus] = useState<Record<string, "idle" | "loading" | "ok" | "error">>({});
  const [testMessages, setTestMessages] = useState<Record<string, string>>({});

  const selectedProvider = value?.provider || "";

  function handleProviderSelect(id: string) {
    const provider = PROVIDERS.find((p) => p.id === id)!;
    onChange({ provider: id, ...provider.defaultValues } as ModelConfig);
  }

  function handleFieldChange(key: string, val: string) {
    if (key === "api_key") {
      onApiKeyChange(val);
    } else {
      onChange({ ...value!, [key]: val });
    }
  }

  async function handleTest() {
    const provider = selectedProvider;
    setTestStatus((p) => ({ ...p, [provider]: "loading" }));
    setTestMessages((p) => ({ ...p, [provider]: "" }));

    try {
      const res = await fetch("http://localhost:8000/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Merge api_key in for this call only — it never lives in value/localStorage
        body: JSON.stringify({ llm_config: { ...value, api_key: apiKey } }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestStatus((p) => ({ ...p, [provider]: "ok" }));
        setTestMessages((p) => ({ ...p, [provider]: "Connected! Model is responding." }));
        onTestSuccess?.();
      } else {
        setTestStatus((p) => ({ ...p, [provider]: "error" }));
        setTestMessages((p) => ({ ...p, [provider]: data.error || "Connection failed" }));
      }
    } catch {
      setTestStatus((p) => ({ ...p, [provider]: "error" }));
      setTestMessages((p) => ({
        ...p,
        [provider]:
          provider === "ollama"
            ? "Ollama is not running — start it with `ollama serve`"
            : "Sidecar not reachable. Is the Python server running?",
      }));
    }
  }

  const currentProvider = PROVIDERS.find((p) => p.id === selectedProvider);
  const status = testStatus[selectedProvider] || "idle";
  const message = testMessages[selectedProvider] || "";

  return (
    <div className="space-y-4">
      {/* Provider tabs */}
      <div className="flex flex-wrap gap-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            onClick={() => handleProviderSelect(p.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
              selectedProvider === p.id
                ? "bg-brand-600 text-white border-brand-600"
                : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {currentProvider && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <p className="text-xs text-gray-500">{currentProvider.description}</p>

          {currentProvider.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {field.label}
              </label>
              {field.options ? (
                <div className="space-y-1.5">
                  {field.options.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleFieldChange(field.key, opt.value)}
                      className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-all ${
                        (value as any)?.[field.key] === opt.value
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-gray-200 hover:border-gray-300 text-gray-700"
                      }`}
                    >
                      <span className="font-mono font-medium">{opt.label}</span>
                      {opt.note && (
                        <span className="ml-2 text-xs text-gray-400">{opt.note}</span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  type={field.secret ? "password" : "text"}
                  placeholder={field.placeholder}
                  value={field.key === "api_key" ? apiKey : ((value as any)?.[field.key] || "")}
                  onChange={(e) => handleFieldChange(field.key, e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
                />
              )}
            </div>
          ))}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleTest}
              disabled={status === "loading"}
              className="px-4 py-1.5 bg-gray-100 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
            >
              {status === "loading" ? "Testing..." : "Test Connection"}
            </button>
            {status === "ok" && (
              <span className="text-green-600 text-sm">✅ {message}</span>
            )}
            {status === "error" && (
              <span className="text-red-600 text-sm">❌ {message}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
