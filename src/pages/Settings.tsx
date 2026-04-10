import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ModelPicker from "../components/ModelPicker";
import ResumeEditor from "../components/ResumeEditor";
import { getApiKey, setApiKey } from "../lib/secureStore";
import { readConfig, writeConfig, readResume, writeResume } from "../lib/persistenceStore";

const SIDECAR = "http://localhost:8000";

interface Suggestion {
  section: string;
  type: "error" | "warning" | "info";
  message: string;
}

const SUGGESTION_STYLES: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  error:   { bg: "bg-red-50",    border: "border-red-200",    text: "text-red-800",    badge: "bg-red-100 text-red-700" },
  warning: { bg: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-800",  badge: "bg-amber-100 text-amber-700" },
  info:    { bg: "bg-blue-50",   border: "border-blue-200",   text: "text-blue-800",   badge: "bg-blue-100 text-blue-700" },
};

// Build an ordered section map: basics first, then sectionOrder, then anything else.
function buildSectionMap(
  resume: Record<string, unknown>,
  sectionOrder: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (resume.basics) result.basics = resume.basics;
  for (const key of sectionOrder) {
    if (key !== "basics" && resume[key] !== undefined) result[key] = resume[key];
  }
  for (const key of Object.keys(resume)) {
    if (!(key in result) && resume[key] !== undefined) result[key] = resume[key];
  }
  return result;
}

export default function Settings() {
  const navigate = useNavigate();

  // Config state (model, instructions, save path)
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [apiKey, setApiKeyState] = useState("");
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  // Resume state
  const [masterResume, setMasterResume] = useState<Record<string, unknown> | null>(null);
  const [editedResume, setEditedResume] = useState<Record<string, unknown> | null>(null);
  const [displaySections, setDisplaySections] = useState<Record<string, unknown> | null>(null);
  const [resumeDirty, setResumeDirty] = useState(false);
  const [resumeSaving, setResumeSaving] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  // ── Load on mount ──────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([readConfig(), readResume()])
      .then(([cfg, resume]) => {
        setConfig(cfg || {});
        if (cfg?.modelConfig) {
          const mc = cfg.modelConfig as Record<string, string>;
          getApiKey(mc.provider || "").then(setApiKeyState).catch(() => {});
        }
        if (resume) {
          const order = (cfg?.sectionOrder as string[]) || [];
          const sections = buildSectionMap(resume, order);
          setMasterResume(resume);
          setEditedResume(resume);
          setDisplaySections(sections);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Rebuild display whenever editedResume changes
  useEffect(() => {
    if (!editedResume || !config) return;
    const order = (config.sectionOrder as string[]) || [];
    setDisplaySections(buildSectionMap(editedResume, order));
  }, [editedResume, config]);

  // ── Config helpers ─────────────────────────────────────────────────────────

  function updateConfig(updates: Record<string, unknown>) {
    setConfig((prev) => {
      const next = { ...(prev || {}), ...updates };
      if (updates.modelConfig && (updates.modelConfig as any).provider !== (prev?.modelConfig as any)?.provider) {
        const newProvider = (updates.modelConfig as any).provider as string;
        getApiKey(newProvider).then(setApiKeyState).catch(() => {});
      }
      return next;
    });
    setConfigDirty(true);
  }

  function handleApiKeyChange(key: string) {
    setApiKeyState(key);
    setConfigDirty(true);
  }

  async function handleSaveConfig() {
    if (!config) return;
    setConfigSaving(true);
    try {
      const { api_key: _drop, ...safeModel } = (config.modelConfig as any) || {};
      await writeConfig({ ...config, modelConfig: safeModel });
      const provider = (safeModel as any)?.provider || "";
      if (provider) await setApiKey(provider, apiKey).catch(() => {});
      setConfigDirty(false);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } finally {
      setConfigSaving(false);
    }
  }

  // ── Resume helpers ─────────────────────────────────────────────────────────

  function handleSectionChange(key: string, newContent: unknown) {
    setEditedResume((prev) => (prev ? { ...prev, [key]: newContent } : prev));
    setResumeDirty(true);
    setSuggestions(null);
  }

  function handleResetSection(key: string) {
    if (masterResume?.[key] !== undefined) {
      setEditedResume((prev) => (prev ? { ...prev, [key]: masterResume[key] } : prev));
    }
  }

  async function handleReaskSection(key: string, feedback: string) {
    const llmConfig = await fullLlmConfig();
    const res = await fetch(`${SIDECAR}/reask-section`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        section_key: key,
        section_content: editedResume?.[key],
        feedback,
        jd_text: "",
        user_instructions: (config?.userInstructions as string) || "",
        llm_config: llmConfig,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Re-ask failed");
    }
    const data = await res.json();
    setEditedResume((prev) => (prev ? { ...prev, [key]: data.content } : prev));
    setResumeDirty(true);
  }

  async function handleSyncAndSave() {
    if (!editedResume) return;
    setSyncing(true);
    setSyncError(null);
    setSuggestions(null);

    try {
      const llmConfig = await fullLlmConfig();
      const res = await fetch(`${SIDECAR}/sync-master-resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume_before: masterResume || {},
          resume_after: editedResume,
          role: (config?.role as string) || "",
          level: (config?.level as string) || "",
          llm_config: llmConfig,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Sync failed");
      }

      const data = await res.json();
      setSuggestions(data.suggestions || []);

      // If no issues, save immediately
      if (!data.suggestions || data.suggestions.length === 0) {
        await saveResume();
      }
    } catch (e: any) {
      setSyncError(e.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function saveResume() {
    if (!editedResume) return;
    setResumeSaving(true);
    try {
      await writeResume(editedResume);
      setMasterResume(editedResume);
      setResumeDirty(false);
      setSuggestions(null);
    } finally {
      setResumeSaving(false);
    }
  }

  // ── Misc ───────────────────────────────────────────────────────────────────

  async function fullLlmConfig() {
    const base = (config?.modelConfig as Record<string, string>) || {};
    const api_key = await getApiKey(base.provider || "").catch(() => "");
    return { ...base, api_key };
  }

  async function handleReset() {
    if (!confirm("This will clear all setup data and restart onboarding. Continue?")) return;
    await writeConfig({ setupComplete: false });
    await writeResume({});
    navigate("/setup");
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 sticky top-0 z-10">
        <button onClick={() => navigate("/editor")} className="text-gray-500 hover:text-gray-700 text-sm">
          ← Back to Editor
        </button>
        <h1 className="text-lg font-semibold text-gray-800">Settings</h1>
        <div className="ml-auto">
          <button
            onClick={handleSaveConfig}
            disabled={!configDirty || configSaving}
            className="px-4 py-1.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-40 transition-colors"
          >
            {configSaved ? "✓ Saved" : configSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-6 space-y-6">

        {/* ── Edit Master Resume ─────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-800">Master Resume</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                This is your source of truth. Edits here are saved to{" "}
                <span className="font-mono">~/.resume-editor/master_resume.json</span>
              </p>
            </div>
            {resumeDirty && (
              <span className="text-xs text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full">
                Unsaved changes
              </span>
            )}
          </div>

          {displaySections ? (
            <>
              <ResumeEditor
                sections={displaySections}
                originalSections={masterResume}
                onSectionChange={handleSectionChange}
                onReaskSection={handleReaskSection}
                onResetSection={handleResetSection}
                label="Master Resume Sections"
                showReask={true}
              />

              {/* Sync error */}
              {syncError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {syncError}
                </div>
              )}

              {/* Suggestions panel */}
              {suggestions !== null && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-700">
                      Quality Check
                      {suggestions.length > 0
                        ? ` — ${suggestions.length} suggestion${suggestions.length !== 1 ? "s" : ""}`
                        : " — No issues found"}
                    </span>
                    {suggestions.length === 0 && (
                      <span className="text-xs text-green-600 font-medium">✓ Saved</span>
                    )}
                  </div>

                  {suggestions.length > 0 && (
                    <div className="divide-y divide-gray-100">
                      {suggestions.map((s, i) => {
                        const style = SUGGESTION_STYLES[s.type] || SUGGESTION_STYLES.info;
                        return (
                          <div key={i} className={`px-4 py-3 flex gap-3 items-start ${style.bg}`}>
                            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded capitalize shrink-0 mt-0.5 ${style.badge}`}>
                              {s.type}
                            </span>
                            <div>
                              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-2">
                                {s.section}
                              </span>
                              <span className={`text-sm ${style.text}`}>{s.message}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {suggestions.length > 0 && (
                    <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex gap-3 justify-end">
                      <button
                        onClick={() => setSuggestions(null)}
                        className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100"
                      >
                        Keep Editing
                      </button>
                      <button
                        onClick={saveResume}
                        disabled={resumeSaving}
                        className="px-4 py-1.5 text-sm bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 disabled:opacity-50"
                      >
                        {resumeSaving ? "Saving..." : "Save Anyway"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Save & Sync button */}
              {suggestions === null && (
                <div className="flex justify-end">
                  <button
                    onClick={handleSyncAndSave}
                    disabled={syncing || resumeSaving}
                    className="px-5 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
                  >
                    {syncing ? "Checking quality..." : resumeSaving ? "Saving..." : "Save & Sync Resume →"}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-sm text-gray-400">
              No master resume found. Complete setup to extract your resume.
            </div>
          )}
        </section>

        {/* ── Writing Preferences ────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">Writing Preferences</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Instructions for the AI
            </label>
            <textarea
              rows={5}
              placeholder={`Examples:\n- Never use "passionate" or "guru"\n- Always quantify achievements\n- Keep a formal, professional tone`}
              value={(config?.userInstructions as string) || ""}
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
                value={(config?.savePath as string) || "~/Documents/Resumes"}
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
                    // Not in Tauri — user types manually
                  }
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 whitespace-nowrap"
              >
                Browse…
              </button>
            </div>
          </div>
        </section>

        {/* ── AI Model ───────────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">AI Model</h2>
          <ModelPicker
            value={config?.modelConfig as any}
            apiKey={apiKey}
            onChange={(mc) => updateConfig({ modelConfig: mc })}
            onApiKeyChange={handleApiKeyChange}
          />
        </section>

        {/* ── Current Layout ─────────────────────────────────────────────── */}
        {config?.template && (
          <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">Resume Layout</h2>
              <button
                onClick={() => navigate("/setup")}
                className="text-xs text-brand-600 hover:underline"
              >
                Change via Setup →
              </button>
            </div>
            <div className="flex gap-6 text-sm text-gray-600">
              <div>
                <span className="text-xs text-gray-400 block mb-0.5">Template</span>
                <span className="font-medium capitalize">{config.template as string}</span>
              </div>
              <div>
                <span className="text-xs text-gray-400 block mb-0.5">Role</span>
                <span className="font-medium">{(config.role as string) || "—"}</span>
              </div>
              <div>
                <span className="text-xs text-gray-400 block mb-0.5">Level</span>
                <span className="font-medium capitalize">{(config.level as string) || "—"}</span>
              </div>
            </div>
            {Array.isArray(config.sectionOrder) && (
              <div>
                <span className="text-xs text-gray-400 block mb-1">Section Order</span>
                <div className="flex flex-wrap gap-1.5">
                  {(config.sectionOrder as string[]).map((s, i) => (
                    <span key={s} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {i + 1}. {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Danger Zone ────────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-red-100 p-6">
          <h2 className="font-semibold text-red-700 mb-3">Danger Zone</h2>
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100"
          >
            Reset App &amp; Redo Setup
          </button>
          <p className="text-xs text-gray-400 mt-2">
            Clears config and master resume. Your exported PDFs are not affected.
          </p>
        </section>
      </div>
    </div>
  );
}
