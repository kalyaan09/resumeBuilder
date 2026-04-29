import { useState } from "react";
import { Button } from "../ui";
import { cn } from "../ui/cn";
import { PlugZap } from "lucide-react";
import { formatAiError } from "../ui/errorFormat";

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
    description: "Free tier available; no credit card required",
    fields: [
      { key: "api_key", label: "API Key", placeholder: "AIza...", secret: true },
      {
        key: "model",
        label: "Model",
        placeholder: "gemini-3-flash",
        options: [
          { value: "gemini-2.5-flash",            label: "gemini-2.5-flash",            note: "Recommended: fast, stable" },
          { value: "gemini-3-flash-preview",       label: "gemini-3-flash-preview",       note: "Latest flash, fast general use" },
          { value: "gemini-3.1-pro-preview",       label: "gemini-3.1-pro-preview",       note: "Best quality for complex reasoning and coding" },
          { value: "gemini-3.1-flash-lite-preview",label: "gemini-3.1-flash-lite-preview",note: "Fastest, low latency and high volume" },
          { value: "gemma-4-31b-it",               label: "gemma-4-31b-it",               note: "Open-weight model" },
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
  /** Called when a test connection succeeds; use to mark the model as verified */
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
        // Merge api_key in for this call only; it never lives in value/localStorage
        body: JSON.stringify({ llm_config: { ...value, api_key: apiKey } }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestStatus((p) => ({ ...p, [provider]: "ok" }));
        setTestMessages((p) => ({ ...p, [provider]: "Connected! Model is responding." }));
        onTestSuccess?.();
      } else {
        const rawError =
          typeof data?.error === "string"
            ? data.error
            : data?.error
              ? JSON.stringify(data.error)
              : typeof data?.message === "string"
                ? data.message
                : "Connection failed";
        setTestStatus((p) => ({ ...p, [provider]: "error" }));
        setTestMessages((p) => ({ ...p, [provider]: `Error code: ${res.status} - ${rawError}` }));
      }
    } catch {
      setTestStatus((p) => ({ ...p, [provider]: "error" }));
      setTestMessages((p) => ({
        ...p,
        [provider]:
          provider === "ollama"
            ? "Ollama is not running. Start it with `ollama serve`"
            : "Could not reach the local preview service. Try starting the app again.",
      }));
    }
  }

  const currentProvider = PROVIDERS.find((p) => p.id === selectedProvider);
  const status = testStatus[selectedProvider] || "idle";
  const message = testMessages[selectedProvider] || "";
  const friendlyError = status === "error" ? formatAiError(message) : null;

  return (
    <div className="space-y-4">
      {/* Provider tabs */}
      <div className="flex flex-wrap gap-2">
        {PROVIDERS.map((p) => (
          <Button
            key={p.id}
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => handleProviderSelect(p.id)}
            className={cn(
              "h-auto rounded-xl px-3 py-2 text-sm font-medium",
              selectedProvider === p.id
                ? "bg-black/[0.07] text-gray-900 shadow-sm dark:bg-white/[0.12] dark:text-white"
                : "text-gray-700 hover:bg-black/[0.05] dark:text-gray-200 dark:hover:bg-white/[0.08]"
            )}
          >
            {p.name}
          </Button>
        ))}
      </div>

      {currentProvider && (
        <div className="space-y-3 rounded-xl border border-gray-200/80 bg-white/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.06]">
          <p className="text-xs text-gray-500 dark:text-gray-400">{currentProvider.description}</p>

          {currentProvider.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {field.label}
              </label>
              {field.options ? (
                <div className="space-y-1.5">
                  {field.options.map((opt) => (
                    <Button
                      key={opt.value}
                      type="button"
                      variant="secondary"
                      size="xs"
                      onClick={() => handleFieldChange(field.key, opt.value)}
                      className={cn(
                        "h-auto w-full justify-start rounded-xl px-3 py-2 text-left",
                        (value as any)?.[field.key] === opt.value
                          ? "border-brand-500/70 bg-brand-50/70 text-brand-700 dark:border-brand-400/25 dark:bg-brand-900/20 dark:text-white"
                          : "text-gray-700 dark:text-gray-200"
                      )}
                    >
                      <span className="font-mono font-medium">{opt.label}</span>
                      {opt.note && (
                        <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{opt.note}</span>
                      )}
                    </Button>
                  ))}
                </div>
              ) : (
                <input
                  type={field.secret ? "password" : "text"}
                  placeholder={field.placeholder}
                  value={field.key === "api_key" ? apiKey : ((value as any)?.[field.key] || "")}
                  onChange={(e) => handleFieldChange(field.key, e.target.value)}
                  className="w-full rounded-xl border border-gray-200/80 bg-white/70 px-3 py-2 font-mono text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-sm focus:outline-none focus-visible:shadow-focus dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-100"
                />
              )}
            </div>
          ))}

          <div className="flex items-center gap-3 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={handleTest}
              disabled={status === "loading"}
            >
              <PlugZap data-icon="inline-start" />
              {status === "loading" ? "Testing..." : "Test Connection"}
            </Button>
            {status === "ok" && (
              <span className="text-emerald-600 dark:text-emerald-400 text-sm">✅ {message}</span>
            )}
            {status === "error" && (
              <span className="text-red-600 dark:text-red-400 text-sm" title={friendlyError?.raw}>
                ❌ {friendlyError?.message || message}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
