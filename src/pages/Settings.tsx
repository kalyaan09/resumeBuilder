import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ModelPicker from "../components/ModelPicker";
import { getApiKey, setApiKey } from "../lib/secureStore";

export default function Settings() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<any>(null);
  const [apiKey, setApiKeyState] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("resume_editor_config");
    if (!raw) return;
    const parsed = JSON.parse(raw);

    // Migrate: if api_key is still sitting inside modelConfig in localStorage, pull it out
    if (parsed.modelConfig?.api_key) {
      const { api_key, ...safeModelConfig } = parsed.modelConfig;
      parsed.modelConfig = safeModelConfig;
      localStorage.setItem("resume_editor_config", JSON.stringify(parsed));
      // Save migrated key to secure store
      setApiKey(parsed.modelConfig.provider || "", api_key).catch(() => {});
      setApiKeyState(api_key);
    }

    setConfig(parsed);

    // Load the api_key for the current provider from secure store
    if (parsed.modelConfig?.provider) {
      getApiKey(parsed.modelConfig.provider).then(setApiKeyState).catch(() => {});
    }
  }, []);

  // When the provider tab changes, load that provider's key from secure store and reset tested flag
  function updateConfig(updates: any) {
    setConfig((prev: any) => {
      const next = { ...prev, ...updates };
      if (updates.modelConfig) {
        // Any change to model config invalidates the tested status
        next.modelTested = false;
        if (updates.modelConfig.provider !== prev?.modelConfig?.provider) {
          getApiKey(updates.modelConfig.provider).then(setApiKeyState).catch(() => {});
        }
      }
      return next;
    });
  }

  function handleApiKeyChange(key: string) {
    setApiKeyState(key);
    // Changing the key invalidates tested status
    setConfig((prev: any) => ({ ...prev, modelTested: false }));
  }

  function handleTestSuccess() {
    setConfig((prev: any) => ({ ...prev, modelTested: true }));
  }

  async function handleSave() {
    setSaving(true);
    // Never persist api_key inside modelConfig
    const { api_key: _drop, ...safeModelConfig } = config.modelConfig || {};
    const safeConfig = { ...config, modelConfig: safeModelConfig };
    localStorage.setItem("resume_editor_config", JSON.stringify(safeConfig));
    // Save api_key to encrypted store
    if (config.modelConfig?.provider) {
      await setApiKey(config.modelConfig.provider, apiKey).catch(() => {});
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleReset() {
    if (confirm("This will clear all setup data and restart the onboarding. Continue?")) {
      localStorage.removeItem("resume_editor_config");
      window.location.href = "/setup";
    }
  }

  if (!config) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <button
          onClick={() => navigate("/editor")}
          className="text-gray-500 hover:text-gray-700 text-sm"
        >
          ← Back to Editor
        </button>
        <h1 className="text-lg font-semibold text-gray-800">Settings</h1>
        <div className="ml-auto flex gap-3">
          <button
            onClick={handleSave}
            className="px-4 py-1.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
          >
            {saved ? "✓ Saved" : saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-6 space-y-6">
        {/* Resume preferences */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">Resume Preferences</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Page Limit
            </label>
            <div className="flex gap-2">
              {[1, 2].map((p) => (
                <button
                  key={p}
                  onClick={() => updateConfig({ pageCount: p })}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all border ${
                    config.pageCount === p
                      ? "bg-brand-600 text-white border-brand-600"
                      : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {p} page{p !== 1 ? "s" : ""}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Writing Instructions
            </label>
            <textarea
              rows={5}
              value={config.userInstructions || ""}
              onChange={(e) => updateConfig({ userInstructions: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default PDF Save Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={config.savePath || ""}
                onChange={(e) => updateConfig({ savePath: e.target.value })}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { open } = await import("@tauri-apps/plugin-dialog");
                    const selected = await open({ directory: true, multiple: false });
                    if (selected && typeof selected === "string") updateConfig({ savePath: selected });
                  } catch {
                    // Not in Tauri context — user types path manually
                  }
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 whitespace-nowrap"
              >
                Browse…
              </button>
            </div>
          </div>
        </section>

        {/* Resume Template */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
          <h2 className="font-semibold text-gray-800">Resume Template</h2>
          <p className="text-xs text-gray-500">
            The .docx or .tex file used as the formatting base for PDF export.
          </p>

          {config.templateName ? (
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <span className="text-sm text-gray-700 flex-1 font-medium truncate">{config.templateName}</span>
              <label className="cursor-pointer text-xs text-brand-600 hover:underline whitespace-nowrap">
                Replace
                <input
                  type="file"
                  accept=".docx,.tex"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => updateConfig({
                      templateName: file.name,
                      templateContent: reader.result as string,
                    });
                    reader.readAsDataURL(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-gray-300 transition-colors">
              <input
                type="file"
                accept=".docx,.tex"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => updateConfig({
                    templateName: file.name,
                    templateContent: reader.result as string,
                  });
                  reader.readAsDataURL(file);
                  e.target.value = "";
                }}
              />
              <p className="text-sm text-gray-400">No template — click to upload</p>
              <p className="text-xs text-gray-400 mt-0.5">.docx · .tex</p>
            </label>
          )}
        </section>

        {/* Research File */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
          <h2 className="font-semibold text-gray-800">Research File</h2>
          <p className="text-xs text-gray-500">
            Background research about you (e.g. an LLM-generated profile). Sent to the AI on every edit to provide extra context.
          </p>

          {config.researchName ? (
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <span className="text-sm text-gray-700 flex-1 font-medium truncate">{config.researchName}</span>
              <label className="cursor-pointer text-xs text-brand-600 hover:underline whitespace-nowrap">
                Replace
                <input
                  type="file"
                  accept=".txt,.docx,.pdf,.md"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => updateConfig({
                      researchName: file.name,
                      researchContent: reader.result as string,
                    });
                    reader.readAsDataURL(file);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                onClick={() => updateConfig({ researchName: "", researchContent: "" })}
                className="text-xs text-red-500 hover:underline whitespace-nowrap"
              >
                Remove
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-gray-300 transition-colors">
              <input
                type="file"
                accept=".txt,.docx,.pdf,.md"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => updateConfig({
                    researchName: file.name,
                    researchContent: reader.result as string,
                  });
                  reader.readAsDataURL(file);
                  e.target.value = "";
                }}
              />
              <p className="text-sm text-gray-400">No research file — click to upload</p>
              <p className="text-xs text-gray-400 mt-0.5">.txt · .md · .docx · .pdf</p>
            </label>
          )}
        </section>

        {/* AI Model */}
        <section className={`bg-white rounded-xl border p-6 space-y-4 ${config.modelTested ? "border-green-200" : "border-amber-200"}`}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">AI Model Configuration</h2>
            {config.modelTested ? (
              <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">✓ Verified</span>
            ) : (
              <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Not tested — run Test Connection</span>
            )}
          </div>
          <ModelPicker
            value={config.modelConfig}
            apiKey={apiKey}
            onChange={(mc) => updateConfig({ modelConfig: mc })}
            onApiKeyChange={handleApiKeyChange}
            onTestSuccess={handleTestSuccess}
          />
        </section>

        {/* Danger zone */}
        <section className="bg-white rounded-xl border border-red-100 p-6">
          <h2 className="font-semibold text-red-700 mb-3">Danger Zone</h2>
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100"
          >
            Reset App & Redo Setup
          </button>
        </section>
      </div>
    </div>
  );
}
