import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ModelPicker from "../components/ModelPicker";
import ResumeEditor from "../components/ResumeEditor";
import AppSidebar from "../components/AppSidebar";
import { getApiKey, setApiKey } from "../lib/secureStore";
import { readConfig, writeConfig, readResume, writeResume } from "../lib/persistenceStore";
import { applyTheme, Theme } from "../lib/themeStore";
import { Button, Modal, SegmentedControl, Surface } from "../ui";
import { Save, Sparkles } from "lucide-react";
import { cn } from "../ui/cn";

const SIDECAR = "http://localhost:8000";

const TEMPLATE_LABELS: Record<string, string> = {
  jake: "Jake's Resume",
  faangpath: "FAANGPath",
  sb2nov: "RenderCV (sb2nov)",
  myresume: "My Resume",
};

const THEME_LABELS: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

type SettingsNavId = "layout" | "resume" | "prefs" | "model" | "appearance" | "danger";

const SETTINGS_NAV: { id: SettingsNavId; label: string; danger?: boolean }[] = [
  { id: "layout", label: "Resume layout" },
  { id: "resume", label: "Master resume" },
  { id: "prefs", label: "Writing preferences" },
  { id: "model", label: "AI model" },
  { id: "appearance", label: "Appearance" },
  { id: "danger", label: "Danger zone", danger: true },
];

/** Match AppSidebar Editor/Settings nav: filled pill when active, ghost when idle. */
function settingsNavItemClass(isActive: boolean, danger?: boolean) {
  return cn(
    "h-auto w-full justify-start rounded-xl px-3 py-2.5 text-left text-sm font-medium",
    danger
      ? isActive
        ? "bg-red-500/12 text-red-900 shadow-sm dark:bg-red-500/18 dark:text-red-100"
        : "text-red-600 hover:bg-red-50/70 dark:text-red-400 dark:hover:bg-red-950/30"
      : isActive
        ? "bg-black/[0.07] text-gray-900 shadow-sm dark:bg-white/[0.12] dark:text-white"
        : "text-gray-700 dark:text-gray-300"
  );
}

interface Suggestion {
  section: string;
  type: "error" | "warning" | "info";
  message: string;
}

const SUGGESTION_STYLES: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  error: { bg: "bg-red-50 dark:bg-red-950/40", border: "border-red-200 dark:border-red-800", text: "text-red-800 dark:text-red-300", badge: "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400" },
  warning: { bg: "bg-amber-50 dark:bg-amber-950/40", border: "border-amber-200 dark:border-amber-800", text: "text-amber-800 dark:text-amber-300", badge: "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400" },
  info: { bg: "bg-blue-50 dark:bg-blue-950/40", border: "border-blue-200 dark:border-blue-800", text: "text-blue-800 dark:text-blue-300", badge: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400" },
};

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

  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [apiKey, setApiKeyState] = useState("");
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  const [masterResume, setMasterResume] = useState<Record<string, unknown> | null>(null);
  const [editedResume, setEditedResume] = useState<Record<string, unknown> | null>(null);
  const [displaySections, setDisplaySections] = useState<Record<string, unknown> | null>(null);
  const [resumeDirty, setResumeDirty] = useState(false);
  const [resumeSaving, setResumeSaving] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  const [savedTemplate, setSavedTemplate] = useState<string>("");
  const [previewModal, setPreviewModal] = useState<string | null>(null);
  const [savedDefaultFontSize, setSavedDefaultFontSize] = useState<number>(10);

  const [activeNav, setActiveNav] = useState<SettingsNavId>("layout");

  useEffect(() => {
    Promise.all([readConfig(), readResume()])
      .then(([cfg, resume]) => {
        setConfig(cfg || {});
        setSavedTemplate((cfg?.template as string) || "");
        setSavedDefaultFontSize((cfg?.defaultFontSize as number) || 10);
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

  useEffect(() => {
    if (!editedResume || !config) return;
    const order = (config.sectionOrder as string[]) || [];
    setDisplaySections(buildSectionMap(editedResume, order));
  }, [editedResume, config]);

  function updateConfig(updates: Record<string, unknown>) {
    setConfig((prev) => {
      const next = { ...(prev || {}), ...updates };
      if (updates.modelConfig && (updates.modelConfig as { provider?: string }).provider !== (prev?.modelConfig as { provider?: string } | undefined)?.provider) {
        const newProvider = (updates.modelConfig as { provider: string }).provider;
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
      const { api_key: _drop, ...safeModel } = (config.modelConfig as Record<string, string> & { api_key?: string }) || {};
      await writeConfig({ ...config, modelConfig: safeModel });
      const provider = (safeModel as { provider?: string })?.provider || "";
      if (provider) await setApiKey(provider, apiKey).catch(() => {});
      setConfigDirty(false);
      setSavedTemplate((config?.template as string) || "");
      setSavedDefaultFontSize((config?.defaultFontSize as number) || 10);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } finally {
      setConfigSaving(false);
    }
  }

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

      if (!data.suggestions || data.suggestions.length === 0) {
        await saveResume();
      }
    } catch (e: unknown) {
      setSyncError(e instanceof Error ? e.message : "Sync failed");
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

  async function fullLlmConfig() {
    const base = (config?.modelConfig as Record<string, string>) || {};
    const api_key = await getApiKey(base.provider || "").catch(() => "");
    return { ...base, api_key };
  }

  async function handleReset() {
    if (!confirm("This will clear your resume data and run setup again. Continue?")) return;
    const prev = (await readConfig()) || {};
    await writeConfig({ ...prev, setupComplete: false });
    await writeResume({});
    navigate("/setup");
  }

  if (loading) {
    return (
      <div className="app-canvas flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  const mc = (config?.modelConfig as Record<string, string>) || {};
  const modelSubtitle = mc.provider ? `${mc.provider} · ${mc.model || "—"}` : "Not configured";
  const instructionText = (config?.userInstructions as string) || "";
  const prefsSubtitle = instructionText
    ? instructionText.split("\n")[0].slice(0, 48) + (instructionText.length > 48 ? "…" : "")
    : "No custom instructions";
  const resumeName = (masterResume?.basics as { name?: string })?.name;
  const resumeSubtitle = resumeName || (masterResume ? "Edit resume content" : "No resume found");
  const currentTheme = (config?.theme as string) || "system";
  const pageHeading = SETTINGS_NAV.find((n) => n.id === activeNav)?.label ?? "Settings";

  return (
    <div className="app-canvas flex h-screen overflow-hidden transition-colors duration-200">
      <AppSidebar active="settings" config={config} />

      <div className="flex min-w-0 flex-1 p-3">
        <Surface variant="panel" className="flex min-w-0 flex-1 overflow-hidden !shadow-glass dark:!shadow-glass-dark">
          <Surface variant="rail" className="flex w-56 shrink-0 flex-col !rounded-none rounded-l-[12px] border-y-0 border-l-0 p-3">
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Settings</p>
            <div className="flex flex-col gap-0.5">
              {SETTINGS_NAV.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  onClick={() => setActiveNav(item.id)}
                  className={settingsNavItemClass(activeNav === item.id, item.danger)}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    {item.label}
                    {item.id === "resume" && resumeDirty ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" />
                    ) : null}
                  </span>
                </Button>
              ))}
            </div>
          </Surface>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200/70 px-6 py-3 dark:border-white/10">
              <div>
                <h1 className="text-lg font-semibold capitalize text-gray-900 dark:text-gray-100">{pageHeading}</h1>
                {activeNav === "layout" && (
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {TEMPLATE_LABELS[config?.template as string] || "Not set"} · {(config?.defaultFontSize as number) || 10}pt default
                  </p>
                )}
                {activeNav === "model" && (
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{modelSubtitle}</p>
                )}
                {activeNav === "prefs" && (
                  <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{prefsSubtitle}</p>
                )}
                {activeNav === "resume" && (
                  <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{resumeSubtitle}</p>
                )}
                {activeNav === "appearance" && (
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{THEME_LABELS[currentTheme] || "System"}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button type="button" variant="secondary" size="sm" className="shrink-0">
                  <Sparkles data-icon="inline-start" />
                  Demo
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleSaveConfig}
                  disabled={!configDirty || configSaving}
                  className="shrink-0"
                >
                  <Save data-icon="inline-start" />
                  {configSaved ? "Saved" : configSaving ? "Saving…" : "Save"}
                </Button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              {activeNav === "layout" && (
                <div className="mx-auto max-w-3xl space-y-5">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    The template only changes how your resume is styled. Your content stays the same.
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    {Object.entries(TEMPLATE_LABELS).map(([id, name]) => {
                      const isSelected = config?.template === id;
                      return (
                        <div
                          key={id}
                          role="button"
                          tabIndex={0}
                          onClick={() => updateConfig({ template: id })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              updateConfig({ template: id });
                            }
                          }}
                          className={`cursor-pointer overflow-hidden rounded-card border-2 transition-all ${
                            isSelected
                              ? "border-brand-600 ring-2 ring-brand-200 dark:ring-brand-800"
                              : "border-gray-200 hover:border-gray-300 dark:border-gray-600 dark:hover:border-gray-500"
                          }`}
                        >
                          <div className="group relative overflow-hidden bg-white" style={{ aspectRatio: "8.5/11" }}>
                            <object
                              data={`${SIDECAR}/template-preview-pdf/${id}#toolbar=0&navpanes=0&scrollbar=0`}
                              type="application/pdf"
                              style={{ width: "100%", height: "100%", display: "block" }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all group-hover:bg-black/25">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewModal(id);
                                }}
                                className="pointer-events-auto rounded-full px-3 py-1.5 text-xs font-semibold opacity-0 shadow-md transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
                              >
                                Full preview
                              </Button>
                            </div>
                          </div>
                          <div
                            className={`flex items-center justify-between px-3 py-2 ${
                              isSelected ? "bg-brand-50 dark:bg-brand-900/20" : "bg-white dark:bg-[#2C2C2E]"
                            }`}
                          >
                            <span
                              className={`truncate text-xs font-medium ${
                                isSelected ? "text-brand-700 dark:text-brand-400" : "text-gray-700 dark:text-gray-300"
                              }`}
                            >
                              {name}
                            </span>
                            {isSelected && (
                              <span className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-600">
                                <svg className="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                                  <path d="M10 3L5 8.5 2 5.5l-1 1 4 4 6-7-1-1z" />
                                </svg>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium text-gray-600 dark:text-gray-400">Default font size</label>
                    <div className="flex max-w-full flex-wrap items-center gap-1.5">
                      <SegmentedControl
                        className="max-w-[min(268px,100%)]"
                        size="sm"
                        value={String((config?.defaultFontSize as number) || 10)}
                        onChange={(v) => updateConfig({ defaultFontSize: Number(v) })}
                        options={[9, 9.5, 10, 10.5, 11].map((size) => ({ value: String(size), label: String(size) }))}
                      />
                      <span className="shrink-0 text-[13px] font-medium tabular-nums text-gray-500 dark:text-gray-400">pt</span>
                    </div>
                  </div>
                  {((config?.template as string) !== savedTemplate || (config?.defaultFontSize as number) !== savedDefaultFontSize) && (
                    <div className="flex justify-end pt-1">
                      <Button type="button" onClick={handleSaveConfig} disabled={configSaving}>
                        {configSaved ? "Saved" : configSaving ? "Saving…" : "Save layout"}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {activeNav === "appearance" && (
                <div className="mx-auto max-w-lg space-y-4">
                  <p className="text-sm text-gray-600 dark:text-gray-300">Choose how Resume Pro looks. You can match your device or pick a fixed look.</p>
                  <SegmentedControl<Theme>
                    value={(currentTheme as Theme) || "system"}
                    onChange={(t) => {
                      updateConfig({ theme: t });
                      applyTheme(t);
                    }}
                    options={(["light", "dark", "system"] as const).map((t) => ({ value: t, label: THEME_LABELS[t] }))}
                  />
                </div>
              )}

              {activeNav === "resume" && (
                <div className="mx-auto max-w-3xl space-y-4">
                  {displaySections ? (
                    <>
                      <ResumeEditor
                        sections={displaySections}
                        originalSections={masterResume}
                        onSectionChange={handleSectionChange}
                        onReaskSection={handleReaskSection}
                        onResetSection={handleResetSection}
                        label="Sections"
                        showReask={true}
                      />
                      {syncError && (
                        <div className="rounded-xl border border-red-200 bg-red-50/90 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                          {syncError}
                        </div>
                      )}
                      {suggestions !== null && (
                        <div className="overflow-hidden rounded-card border border-gray-200 dark:border-gray-600">
                          <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-[#323234]">
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                              Review
                              {suggestions.length > 0
                                ? ` · ${suggestions.length} note${suggestions.length !== 1 ? "s" : ""}`
                                : " · All clear"}
                            </span>
                            {suggestions.length === 0 && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Saved</span>}
                          </div>
                          {suggestions.length > 0 && (
                            <div className="divide-y divide-gray-100 dark:divide-gray-700">
                              {suggestions.map((s, i) => {
                                const style = SUGGESTION_STYLES[s.type] || SUGGESTION_STYLES.info;
                                return (
                                  <div key={i} className={`flex items-start gap-3 px-4 py-3 ${style.bg}`}>
                                    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold capitalize ${style.badge}`}>{s.type}</span>
                                    <div>
                                      <span className="mr-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{s.section}</span>
                                      <span className={`text-sm ${style.text}`}>{s.message}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {suggestions.length > 0 && (
                            <div className="flex justify-end gap-3 border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-[#323234]">
                              <Button type="button" variant="secondary" size="sm" onClick={() => setSuggestions(null)}>
                                Keep editing
                              </Button>
                              <Button type="button" size="sm" onClick={saveResume} disabled={resumeSaving}>
                                {resumeSaving ? "Saving…" : "Save anyway"}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      {suggestions === null && (
                        <div className="flex justify-end">
                          <Button type="button" onClick={handleSyncAndSave} disabled={syncing || resumeSaving}>
                            {syncing ? "Checking…" : resumeSaving ? "Saving…" : "Save & review"}
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">No resume on file yet. Complete setup first.</p>
                  )}
                </div>
              )}

              {activeNav === "prefs" && (
                <div className="mx-auto max-w-2xl space-y-5">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Writing style</label>
                    <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">Tell us the tone and rules you want whenever your resume is tailored.</p>
                    <textarea
                      rows={6}
                      placeholder={`Examples:\n• Quantify results where you can\n• Avoid buzzwords you dislike\n• Keep a calm, professional tone`}
                      value={instructionText}
                      onChange={(e) => updateConfig({ userInstructions: e.target.value })}
                      className="w-full resize-none rounded-xl border border-gray-200 bg-[#F5F5F7]/80 px-4 py-3 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-[#1C1C1E] dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Where to save PDFs</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={(config?.savePath as string) || "~/Documents/Resumes"}
                        onChange={(e) => updateConfig({ savePath: e.target.value })}
                        className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-brand-500 focus:outline-none dark:border-gray-600 dark:bg-[#1C1C1E] dark:text-gray-100"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        className="shrink-0"
                        onClick={async () => {
                          try {
                            const { open } = await import("@tauri-apps/plugin-dialog");
                            const selected = await open({ directory: true, multiple: false });
                            if (selected && typeof selected === "string") updateConfig({ savePath: selected });
                          } catch {
                            /* not in Tauri */
                          }
                        }}
                      >
                        Browse…
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {activeNav === "model" && (
                <div className="mx-auto max-w-2xl">
                  <ModelPicker
                    value={config?.modelConfig as never}
                    apiKey={apiKey}
                    onChange={(mcc) => updateConfig({ modelConfig: mcc })}
                    onApiKeyChange={handleApiKeyChange}
                  />
                </div>
              )}

              {activeNav === "danger" && (
                <div className="mx-auto max-w-lg space-y-4">
                  <p className="text-sm text-gray-600 dark:text-gray-300">Start fresh with setup. Exported files on your computer are not removed.</p>
                  <Button type="button" variant="destructive" onClick={handleReset}>
                    Reset and run setup again
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Surface>
      </div>

      <Modal
        open={!!previewModal}
        onOpenChange={(open) => !open && setPreviewModal(null)}
        title={previewModal ? TEMPLATE_LABELS[previewModal] : "Preview"}
        className="w-[min(900px,96vw)]"
        footer={
          <p className="text-center text-[11px] text-gray-500 dark:text-gray-400">Sample preview · scroll to see the full page</p>
        }
      >
        {previewModal ? (
          <div className="h-[min(78vh,760px)] min-h-[420px] w-full bg-neutral-200 dark:bg-neutral-700">
            <object
              key={previewModal}
              data={`${SIDECAR}/template-preview-pdf/${previewModal}#toolbar=1&navpanes=0`}
              type="application/pdf"
              className="h-full w-full"
              style={{ display: "block" }}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
