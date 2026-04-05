import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ModelPicker from "../components/ModelPicker";

export default function Settings() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("resume_editor_config");
    if (raw) setConfig(JSON.parse(raw));
  }, []);

  function updateConfig(updates: any) {
    setConfig((prev: any) => ({ ...prev, ...updates }));
  }

  async function handleSave() {
    setSaving(true);
    localStorage.setItem("resume_editor_config", JSON.stringify(config));
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
            <input
              type="text"
              value={config.savePath || ""}
              onChange={(e) => updateConfig({ savePath: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
            />
          </div>
        </section>

        {/* AI Model */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">AI Model Configuration</h2>
          <ModelPicker
            value={config.modelConfig}
            onChange={(mc) => updateConfig({ modelConfig: mc })}
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
