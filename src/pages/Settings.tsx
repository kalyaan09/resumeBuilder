import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ModelPicker from "../components/ModelPicker";
import { RoleCombobox } from "../components/RoleCombobox";
import ResumeEditor from "../components/ResumeEditor";
import SectionOrderEditor from "../components/SectionOrderEditor";
import AppSidebar from "../components/AppSidebar";
import { getApiKey, setApiKey } from "../lib/secureStore";
import { readConfig, writeConfig, readShared, readProfileResume, writeResume } from "../lib/persistenceStore";
import { applyTheme, Theme } from "../lib/themeStore";
import { Button, Modal, SegmentedControl, Surface, TypographyMuted } from "../ui";
import { FolderOpen, Save, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "../ui/cn";
import { formatAiError } from "../ui/errorFormat";
import { useProfiles } from "../context/ProfilesContext";
import { createProfile, deleteProfile as deleteProfileApi, getProfileResume, getShared, putProfileResume, putShared, resetAll } from "../lib/sidecarApi";
import { CORE_SECTION_KEYS, SECTION_LABELS, computeSectionsWithData, getDefaultSectionOrderFromConfig, mergeVisibleReorderWithHidden } from "../lib/sectionOrder";

const SIDECAR = "http://localhost:8000";
/** Bump when python/main.py PREVIEW_VERSION changes (busts WebView cache for embedded PDFs). */
const PREVIEW_ASSET_VERSION = 7;

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

type SettingsNavId = "layout" | "resume" | "profiles" | "prefs" | "model" | "appearance" | "danger";

const SETTINGS_NAV: { id: SettingsNavId; label: string; danger?: boolean }[] = [
  { id: "layout", label: "Resume Layout" },
  { id: "resume", label: "Basic Info" },
  { id: "profiles", label: "Profiles" },
  { id: "prefs", label: "Writing Preferences" },
  { id: "model", label: "AI Model" },
  { id: "appearance", label: "Appearance" },
  { id: "danger", label: "Reset", danger: true },
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

function TemplateThumb({
  id,
  name,
  selected,
  onOpenPreview,
}: {
  id: string;
  name: string;
  selected: boolean;
  onOpenPreview: () => void;
}) {
  const pdfSrc = `${SIDECAR}/template-preview-pdf/${id}?v=${PREVIEW_ASSET_VERSION}#toolbar=0&navpanes=0&scrollbar=0`;

  return (
    <div
      className={cn(
        "group relative w-full min-w-0 overflow-hidden rounded-card border-2 transition-all",
        selected ? "border-[#2563EB]" : "border-gray-200 hover:border-gray-300 dark:border-gray-600 dark:hover:border-gray-500"
      )}
    >
      {selected ? (
        <div
          className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-[#2563EB] text-white shadow-md"
          aria-hidden
        >
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 12 12" aria-hidden>
            <path d="M10 3L5 8.5 2 5.5l-1 1 4 4 6-7-1-1z" />
          </svg>
        </div>
      ) : null}

      <div className="relative overflow-hidden bg-white" style={{ aspectRatio: "8.5/11" }}>
        <object
          data={pdfSrc}
          type="application/pdf"
          className="block h-full w-full bg-white"
          style={{ width: "100%", height: "100%", pointerEvents: "none" }}
        >
          <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs text-gray-400">
            PDF preview not available. Use “Full preview”.
          </div>
        </object>

        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all group-hover:bg-black/25">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onOpenPreview();
            }}
            className="pointer-events-auto rounded-full px-3 py-1.5 text-xs font-semibold opacity-0 shadow-md transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
          >
            Full preview
          </Button>
        </div>
      </div>

      <div className={cn("flex items-center justify-between px-3 py-2", selected ? "bg-brand-50 dark:bg-brand-900/20" : "bg-white dark:bg-[#2C2C2E]")}>
        <span className={cn("truncate text-xs font-medium", selected ? "text-brand-700 dark:text-brand-400" : "text-gray-700 dark:text-gray-300")}>
          {name}
        </span>
      </div>
    </div>
  );
}

interface Suggestion {
  section: string;
  type: "error" | "warning" | "info";
  message: string;
}


// Profile JSON contains "id" and "name" metadata. Never render these as resume sections.
const PROFILE_METADATA_KEYS = new Set(["id", "name", "useCustomSectionOrder", "sectionOrder"]);

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
    if (!(key in result) && resume[key] !== undefined && !PROFILE_METADATA_KEYS.has(key)) result[key] = resume[key];
  }
  return result;
}

export default function Settings() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profiles, activeProfileId, switchTo, refresh } = useProfiles();

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

  const [editedShared, setEditedShared] = useState<Record<string, unknown> | null>(null);
  const [editedProfile, setEditedProfile] = useState<Record<string, unknown> | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [dismissedReviewBanner, setDismissedReviewBanner] = useState(false);
  const [showReviewErrorDetails, setShowReviewErrorDetails] = useState(false);

  const [loading, setLoading] = useState(true);

  const [previewModal, setPreviewModal] = useState<string | null>(null);

  const [activeNav, setActiveNav] = useState<SettingsNavId>("layout");
  const [resetOpen, setResetOpen] = useState(false);
  const [createProfileOpen, setCreateProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileFile, setNewProfileFile] = useState<File | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [addSectionKey, setAddSectionKey] = useState<string>("certifications");
  const [addSectionScope, setAddSectionScope] = useState<"profile" | "all">("profile");
  const [addSectionBusy, setAddSectionBusy] = useState(false);
  const [addSectionError, setAddSectionError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await readConfig();
        setConfig(cfg || {});
        if (cfg?.modelConfig) {
          const mc = cfg.modelConfig as Record<string, string>;
          getApiKey(mc.provider || "").then(setApiKeyState).catch(() => {});
        }
        const activeId = (cfg?.activeProfile as string) || null;
        if (activeId) {
          const [shared, profile] = await Promise.all([readShared(), readProfileResume(activeId)]);
          if (shared || profile) {
            const merged = { ...(profile || {}), ...(shared || {}) };
            const order = getDefaultSectionOrderFromConfig(cfg || {});
            setMasterResume(merged);
            setEditedResume(merged);
            setDisplaySections(buildSectionMap(merged, order));
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Allow deep-linking to a specific settings tab, e.g. /settings?tab=layout
  useEffect(() => {
    const params = new URLSearchParams(location.search || "");
    const tab = params.get("tab");
    if (!tab) return;
    const allowed: SettingsNavId[] = ["layout", "resume", "profiles", "prefs", "model", "appearance", "danger"];
    if (allowed.includes(tab as SettingsNavId)) {
      setActiveNav(tab as SettingsNavId);
    }
  }, [location.search]);

  // Refresh profiles list every time the profiles tab becomes active.
  useEffect(() => {
    if (activeNav === "profiles") {
      refresh();
    }
  }, [activeNav]);

  // If backend profiles exist, prefer server-backed shared/profile data for Master Resume editing.
  useEffect(() => {
    if (!activeProfileId) return;
    if (profiles.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const [shared, profile] = await Promise.all([getShared(), getProfileResume(activeProfileId)]);
        if (cancelled) return;
        setEditedShared(shared || {});
        setEditedProfile(profile || {});

        const merged = { ...(profile || {}), ...(shared || {}) };
        setMasterResume(merged);
        setEditedResume(merged);
        const order = getDefaultSectionOrderFromConfig(config || {});
        setDisplaySections(buildSectionMap(merged, order));
      } catch {
        // If server endpoints aren't available, keep local persistence behavior.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, profiles.length, config]);

  useEffect(() => {
    if (!editedResume || !config) return;
    const order = getDefaultSectionOrderFromConfig(config);
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
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } finally {
      setConfigSaving(false);
    }
  }

  function handleSectionChange(key: string, newContent: unknown) {
    // If server-backed profiles are active, keep shared/profile parts split.
    if (activeProfileId && profiles.length > 0) {
      if (key === "basics" || key === "education") {
        setEditedShared((prev) => ({ ...(prev || {}), [key]: newContent }));
        setEditedResume((prev) => (prev ? { ...prev, [key]: newContent } : prev));
      } else {
        setEditedProfile((prev) => ({ ...(prev || {}), [key]: newContent }));
        setEditedResume((prev) => (prev ? { ...prev, [key]: newContent } : prev));
      }
    } else {
      setEditedResume((prev) => (prev ? { ...prev, [key]: newContent } : prev));
    }
    setResumeDirty(true);
    setSuggestions(null);
  }

  function handleResetSection(key: string) {
    if (masterResume?.[key] !== undefined) {
      setEditedResume((prev) => (prev ? { ...prev, [key]: masterResume[key] } : prev));
      if (activeProfileId && profiles.length > 0 && (key === "basics" || key === "education")) {
        setEditedShared((prev) => ({ ...(prev || {}), [key]: masterResume[key] }));
      }
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
    if (activeProfileId && profiles.length > 0 && (key === "basics" || key === "education")) {
      setEditedShared((prev) => ({ ...(prev || {}), [key]: data.content }));
    }
    setResumeDirty(true);
  }

  async function handleSyncAndSave() {
    if (!editedResume) return;
    setSyncing(true);
    setSyncError(null);
    setSuggestions(null);
    setDismissedReviewBanner(false);
    setShowReviewErrorDetails(false);

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
      // Keep suggestions cleared so UI doesn't imply "all clear"
      setSuggestions(null);
    } finally {
      setSyncing(false);
    }
  }

  async function saveResume() {
    if (!editedResume) return;
    setResumeSaving(true);
    try {
      if (activeProfileId && profiles.length > 0) {
        await Promise.all([
          putShared(editedShared || {}).catch(() => {}),
          putProfileResume(activeProfileId, editedProfile || {}).catch(() => {}),
        ]);
      } else {
        await writeResume(editedResume);
      }
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
    await resetAll();
    // Clear all localStorage keys so stale data doesn't re-seed the wiped files
    Object.keys(localStorage)
      .filter(k => k.startsWith("re_"))
      .forEach(k => localStorage.removeItem(k));
    navigate("/setup");
  }

  const splitResumeSources = Boolean(activeProfileId && profiles.length > 0);
  const resumeEditorSections = useMemo(() => {
    if (!displaySections) return null;
    if (!splitResumeSources) return displaySections;
    const o: Record<string, unknown> = {};
    if (displaySections.basics !== undefined) o.basics = displaySections.basics;
    if (displaySections.education !== undefined) o.education = displaySections.education;
    return Object.keys(o).length ? o : null;
  }, [displaySections, splitResumeSources]);

  const resumeEditorOriginal = useMemo(() => {
    if (!masterResume) return null;
    if (!splitResumeSources) return masterResume;
    const o: Record<string, unknown> = {};
    if (masterResume.basics !== undefined) o.basics = masterResume.basics;
    if (masterResume.education !== undefined) o.education = masterResume.education;
    return Object.keys(o).length ? o : null;
  }, [masterResume, splitResumeSources]);

  const profileResumeForFilter = splitResumeSources ? editedProfile : null;
  const visibleLayoutKeys = useMemo(() => computeSectionsWithData(profileResumeForFilter), [profileResumeForFilter, activeProfileId]);
  const visibleLayoutKeySet = useMemo(() => new Set<string>(visibleLayoutKeys), [visibleLayoutKeys]);

  const currentDefaultOrder = useMemo(() => getDefaultSectionOrderFromConfig(config), [config]);
  const visibleLayoutOrder = useMemo(() => {
    const base = currentDefaultOrder.filter((k) => visibleLayoutKeySet.has(k));
    for (const k of visibleLayoutKeys) {
      if (!base.includes(k)) base.push(k);
    }
    return base;
  }, [currentDefaultOrder, visibleLayoutKeySet, visibleLayoutKeys]);

  const addableOptionalKeys = useMemo(() => {
    const core = new Set<string>(CORE_SECTION_KEYS);
    const known = Array.from(new Set(currentDefaultOrder));
    return known.filter((k) => !core.has(k) && !visibleLayoutKeySet.has(k));
  }, [currentDefaultOrder, visibleLayoutKeySet]);

  async function deleteSectionFromActiveProfile(sectionKey: string) {
    if (!activeProfileId || !splitResumeSources) return;
    try {
      const current = await getProfileResume(activeProfileId);
      if (current && typeof current === "object") {
        const next = { ...(current as Record<string, unknown>) };
        delete next[sectionKey];
        await putProfileResume(activeProfileId, next);
        setEditedProfile(next);
        // merged view is recomputed by effects
      }
    } catch (e: unknown) {
      setProfileError(e instanceof Error ? e.message : "Could not delete section");
    }
  }

  function seedSectionValue(key: string): unknown {
    if (key === "certifications") return [{ name: "", issuer: "", date: "" }];
    if (key === "publications") return [{ title: "", journal: "", date: "", link: "" }];
    if (key === "awards") return [{}];
    if (key === "volunteer") return [{}];
    if (key === "languages") return [{ language: "", fluency: "" }];
    return [{}];
  }

  async function handleConfirmAddSection() {
    if (!splitResumeSources) return;
    if (!activeProfileId) return;
    setAddSectionBusy(true);
    setAddSectionError(null);
    try {
      if (addSectionScope === "profile") {
        const current = await getProfileResume(activeProfileId);
        const next = { ...(current || {}) } as Record<string, unknown>;
        if (next[addSectionKey] === undefined) next[addSectionKey] = seedSectionValue(addSectionKey);
        await putProfileResume(activeProfileId, next);
        setEditedProfile(next);
      } else {
        // All profiles
        for (const p of profiles) {
          const current = await getProfileResume(p.id);
          const next = { ...(current || {}) } as Record<string, unknown>;
          if (next[addSectionKey] === undefined) next[addSectionKey] = seedSectionValue(addSectionKey);
          await putProfileResume(p.id, next);
        }
        // Refresh the active profile's data in memory
        const refreshed = await getProfileResume(activeProfileId);
        setEditedProfile(refreshed || {});
      }
      setAddSectionOpen(false);
    } catch (e: unknown) {
      setAddSectionError(e instanceof Error ? e.message : "Could not add section");
    } finally {
      setAddSectionBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="app-canvas flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  const mc = (config?.modelConfig as Record<string, string>) || {};
  const modelSubtitle = mc.provider ? `${mc.provider} · ${mc.model || "none"}` : "Not configured";
  const instructionText = (config?.userInstructions as string) || "";
  const prefsSubtitle = instructionText
    ? instructionText.split("\n")[0].slice(0, 48) + (instructionText.length > 48 ? "…" : "")
    : "No custom instructions";
  const resumeName = (masterResume?.basics as { name?: string })?.name;
  const resumeSubtitle =
    activeProfileId && profiles.length > 0
      ? "Basics and education, shared across all profiles"
      : resumeName || (masterResume ? "Edit resume content" : "No resume found");

  const currentTheme = (config?.theme as string) || "system";
  const pageHeading = SETTINGS_NAV.find((n) => n.id === activeNav)?.label ?? "Settings";

  return (
    <div className="app-canvas flex h-screen overflow-hidden transition-colors duration-200">
      <AppSidebar active="settings" config={config} />

      <div className="flex min-w-0 flex-1 p-3">
        <Surface variant="panel" className="flex min-w-0 flex-1 overflow-hidden !shadow-glass dark:!shadow-glass-dark">
          <Surface variant="rail" className="flex w-56 shrink-0 flex-col !rounded-none rounded-l-[12px] border-y-0 border-l-0 p-3">
            <TypographyMuted className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Settings
            </TypographyMuted>
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
                <h1 className="text-[17px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">{pageHeading}</h1>
                {activeNav === "layout" && (
                  <TypographyMuted className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {TEMPLATE_LABELS[config?.template as string] || "Not set"} · {(config?.defaultFontSize as number) || 10}pt default
                  </TypographyMuted>
                )}
                {activeNav === "model" && (
                  <TypographyMuted className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{modelSubtitle}</TypographyMuted>
                )}
                {activeNav === "prefs" && (
                  <TypographyMuted className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{prefsSubtitle}</TypographyMuted>
                )}
                {activeNav === "resume" && (
                  <TypographyMuted className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{resumeSubtitle}</TypographyMuted>
                )}
                {activeNav === "appearance" && (
                  <TypographyMuted className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {THEME_LABELS[currentTheme] || "System"}
                  </TypographyMuted>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {activeNav === "resume" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleSyncAndSave}
                    disabled={!resumeDirty || syncing || resumeSaving}
                    className="shrink-0"
                    title={!resumeDirty ? "Make a change to review again" : undefined}
                  >
                    <Sparkles data-icon="inline-start" />
                    {syncing ? "Checking…" : resumeSaving ? "Saving…" : "Review"}
                  </Button>
                ) : null}
                {activeNav !== "danger" ? (
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
                ) : null}
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              {activeNav === "layout" && (
                <div className="mx-auto w-full max-w-5xl space-y-5">
                  <TypographyMuted className="text-xs text-gray-500 dark:text-gray-400">
                    The template only changes how your resume is styled. Your content stays the same.
                  </TypographyMuted>
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
                          className="cursor-pointer"
                        >
                          <TemplateThumb
                            id={id}
                            name={name}
                            selected={isSelected}
                            onOpenPreview={() => setPreviewModal(id)}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium text-gray-600 dark:text-gray-400">Default Font Size</label>
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
                  <div>
                    <label className="mb-2 block text-xs font-medium text-gray-600 dark:text-gray-400">Default Section Order</label>
                    <TypographyMuted className="mb-2 block w-full max-w-none text-xs">
                      Drag to set the global PDF section order. Profiles can override on each profile&apos;s edit page.
                    </TypographyMuted>
                    {config ? (
                      <>
                        <SectionOrderEditor
                          orderedKeys={visibleLayoutOrder}
                          onReorder={(nextVisible) => {
                            const merged = mergeVisibleReorderWithHidden({
                              currentDefaultOrder,
                              visibleOrder: nextVisible,
                              visibleKeys: visibleLayoutKeySet,
                            });
                            updateConfig({ defaultSectionOrder: merged, sectionOrder: merged });
                          }}
                          onRemove={
                            splitResumeSources
                              ? (key) => {
                                  void deleteSectionFromActiveProfile(key);
                                }
                              : undefined
                          }
                          canRemove={(key) => splitResumeSources && !CORE_SECTION_KEYS.includes(key as any)}
                        />
                      </>
                    ) : null}
                  </div>
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
                  {resumeEditorSections ? (
                    <>
                      {!dismissedReviewBanner && syncError ? (
                        (() => {
                          const fe = formatAiError(syncError);
                          return (
                        <Surface
                          variant="inset"
                          className="sticky top-0 z-10 -mx-2 mb-2 rounded-xl border border-red-200/80 bg-red-50/80 p-3 shadow-sm backdrop-blur-sm dark:border-red-800/60 dark:bg-red-950/35"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-red-900 dark:text-red-100">{fe.title}</div>
                              <p className="mt-0.5 text-xs text-red-800/90 dark:text-red-200/90">{fe.message}</p>
                              <div className="mt-2 flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  className="h-8 px-3"
                                  onClick={handleSyncAndSave}
                                  disabled={syncing || resumeSaving}
                                >
                                  Try again
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2 text-xs text-red-800 hover:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/15"
                                  onClick={() => setShowReviewErrorDetails((v) => !v)}
                                >
                                  {showReviewErrorDetails ? "Hide details" : "Details"}
                                </Button>
                              </div>
                              {showReviewErrorDetails ? (
                                <pre className="mt-2 overflow-auto rounded-lg bg-white/60 p-2 text-[11px] text-red-900/90 dark:bg-black/20 dark:text-red-100">
                                  {fe.raw}
                                </pre>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              {typeof fe.code === "number" ? (
                                <span className="shrink-0 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-800 dark:bg-red-500/15 dark:text-red-200">
                                  {fe.code}
                                </span>
                              ) : null}
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg text-red-700 hover:bg-red-500/10 hover:text-red-900 dark:text-red-200 dark:hover:bg-red-500/15"
                                onClick={() => setDismissedReviewBanner(true)}
                                aria-label="Dismiss"
                                title="Dismiss"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </Surface>
                          );
                        })()
                      ) : !dismissedReviewBanner && suggestions !== null ? (
                        <Surface
                          variant="inset"
                          className="sticky top-0 z-10 -mx-2 mb-2 rounded-xl border border-white/40 bg-white/70 p-3 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.06]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                                Review
                                {suggestions.length > 0
                                  ? ` · ${suggestions.length} note${suggestions.length !== 1 ? "s" : ""}`
                                  : " · All clear"}
                              </div>
                              <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
                                {suggestions.length > 0
                                  ? "Notes are shown inline inside each section so you can fix them in place."
                                  : "No issues found. You can save now."}
                              </p>
                            </div>
                            {suggestions.length === 0 ? (
                              <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                Saved
                              </span>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-lg text-gray-500 hover:bg-black/[0.06] hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
                              onClick={() => setDismissedReviewBanner(true)}
                              aria-label="Dismiss"
                              title="Dismiss"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </Surface>
                      ) : null}
                      <ResumeEditor
                        sections={resumeEditorSections}
                        originalSections={resumeEditorOriginal}
                        onSectionChange={handleSectionChange}
                        onReaskSection={handleReaskSection}
                        onResetSection={handleResetSection}
                        label={splitResumeSources ? "Basics & education" : "Sections"}
                        showReask={true}
                        suggestions={suggestions}
                      />
                      {/* syncError is shown in the sticky banner above */}
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
                      className="w-full resize-none rounded-xl border border-gray-200/80 bg-white/70 px-4 py-3 text-sm leading-relaxed text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-sm focus:outline-none focus-visible:shadow-focus dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Where to save PDFs</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={(config?.savePath as string) || "~/Documents/Resumes"}
                        onChange={(e) => updateConfig({ savePath: e.target.value })}
                        className="flex-1 rounded-xl border border-gray-200/80 bg-white/70 px-3 py-2 font-mono text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-sm focus:outline-none focus-visible:shadow-focus dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-100"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
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
                        <FolderOpen data-icon="inline-start" />
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

              {activeNav === "profiles" && (
                <div className="mx-auto w-full max-w-2xl space-y-4">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Profiles ({profiles.length}/3 used)
                      </div>
                      <TypographyMuted className="mt-1 text-xs">
                        Switch profiles to tailor different versions of your resume for different roles.
                      </TypographyMuted>
                    </div>
                    {profiles.length < 3 ? (
                      <Button type="button" variant="secondary" size="sm" onClick={() => setCreateProfileOpen(true)}>
                        + Add profile ({3 - profiles.length} remaining)
                      </Button>
                    ) : null}
                  </div>

                  {profileError ? (
                    <div className="rounded-xl border border-red-200/70 bg-red-50/80 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                      {profileError}
                    </div>
                  ) : null}

                  <Surface variant="inset" className="rounded-xl p-2">
                    <div className="divide-y divide-gray-200/60 dark:divide-white/10">
                      {profiles.map((p) => {
                        const isActive = p.id === activeProfileId;
                        return (
                          <div key={p.id} className="flex items-center justify-between gap-3 px-2 py-2.5">
                            <button
                              type="button"
                              className={cn(
                                "flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors",
                                "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                              )}
                              onClick={async () => {
                                try {
                                  setProfileError(null);
                                  await switchTo(p.id);
                                } catch (e: unknown) {
                                  setProfileError(e instanceof Error ? e.message : "Could not switch profile");
                                }
                              }}
                            >
                              <span className={cn("text-sm", isActive ? "text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-200")}>
                                {isActive ? "●" : "○"}
                              </span>
                              <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{p.name}</span>
                            </button>

                            <div className="flex shrink-0 items-center gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate(`/settings/profile/${p.id}/edit`)}
                                title="Edit profile sections"
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-red-700 hover:bg-red-500/10 hover:text-red-900 dark:text-red-300 dark:hover:bg-red-500/15"
                                onClick={() => setDeleteConfirm({ id: p.id, name: p.name })}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        );
                      })}

                      {profiles.length === 0 ? (
                        <div className="px-3 py-10 text-center">
                          <TypographyMuted>No profiles found. Create one to get started.</TypographyMuted>
                        </div>
                      ) : null}
                    </div>
                  </Surface>
                </div>
              )}

              {activeNav === "danger" && (
                <div className="mx-auto max-w-lg space-y-4">
                  <p className="text-sm text-gray-600 dark:text-gray-300">Start fresh with setup. Exported files on your computer are not removed.</p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="rounded-btn border-red-200/80 bg-red-50/80 text-red-800 hover:bg-red-50 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/55"
                    onClick={() => setResetOpen(true)}
                  >
                    <Trash2 data-icon="inline-start" />
                    Reset
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Surface>
      </div>

      <Modal
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset app?"
        description="Clears your saved resume + settings inside the app. Exported PDFs on your computer are not removed."
        descriptionClassName="text-brand-700 dark:text-brand-300"
        className="w-[min(420px,92vw)]"
        overlayClassName="bg-black/25"
        dense
        surface={false}
        contentClassName="rounded-3xl border-white/55 bg-white/80 shadow-[0_22px_70px_rgba(15,23,42,0.22)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.08] dark:shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
        headerClassName="px-4 py-3"
        bodyClassName="overflow-visible"
        footerClassName="bg-transparent px-4 py-3 dark:bg-transparent"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" className="bg-white/70 dark:bg-white/[0.06]" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="border-red-200/80 bg-red-50/80 text-red-800 hover:bg-red-50 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/55"
              onClick={async () => {
                setResetOpen(false);
                await handleReset();
              }}
            >
              <Trash2 data-icon="inline-start" />
              Reset
            </Button>
          </div>
        }
      >
        <div className="px-4 pb-3 pt-2 text-[11px] text-gray-500 dark:text-gray-400">
          This can’t be undone.
        </div>
      </Modal>

      <Modal
        open={createProfileOpen}
        onOpenChange={(o) => {
          setCreateProfileOpen(o);
          if (!o) {
            setNewProfileName("");
            setNewProfileFile(null);
            setProfileError(null);
          }
        }}
        title="Create profile"
        description="Add a role-specific resume. Max 3 profiles."
        className="w-[min(520px,94vw)]"
        overlayClassName="bg-black/25 backdrop-blur-md"
        dense
        surface={false}
        contentClassName="rounded-3xl border-white/55 bg-white/80 shadow-[0_22px_70px_rgba(15,23,42,0.22)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.08] dark:shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
        headerClassName="px-4 py-3"
        bodyClassName="overflow-visible"
        footerClassName="border-t border-white/25 bg-white/45 px-4 py-3 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.06]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" className="bg-white/70 dark:bg-white/[0.06]" onClick={() => setCreateProfileOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={creatingProfile || profiles.length >= 3 || !newProfileName.trim() || !newProfileFile}
              onClick={async () => {
                if (profiles.length >= 3) {
                  setProfileError("You already have 3 profiles. Delete one to add another.");
                  return;
                }
                if (!newProfileName.trim() || !newProfileFile) return;
                setCreatingProfile(true);
                setProfileError(null);
                try {
                  const llmConfig = await fullLlmConfig();
                  await createProfile({ name: newProfileName.trim(), resumeFile: newProfileFile, llm_config: llmConfig });
                  await refresh();
                  setCreateProfileOpen(false);
                } catch (e: unknown) {
                  setProfileError(e instanceof Error ? e.message : "Could not create profile");
                } finally {
                  setCreatingProfile(false);
                }
              }}
            >
              {creatingProfile ? "Creating…" : "Create"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 px-5 pb-5 pt-3">
          {profileError ? (
            <div className="rounded-xl border border-red-200/70 bg-red-50/80 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {profileError}
            </div>
          ) : null}
          <RoleCombobox
            value={newProfileName}
            onChange={setNewProfileName}
            label="Job title"
            inputId="settings-create-profile-role"
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Upload resume file</label>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.tex,.txt"
              onChange={(e) => setNewProfileFile(e.target.files?.[0] || null)}
              className="block w-full cursor-pointer rounded-xl border border-gray-200/70 bg-white/50 px-3 py-2 text-sm text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-brand-700 dark:border-white/12 dark:bg-white/[0.06] dark:text-gray-200 dark:file:bg-brand-500 dark:hover:file:bg-brand-600"
            />
            {newProfileFile ? (
              <TypographyMuted className="mt-1 text-xs">Selected: {newProfileFile.name}</TypographyMuted>
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!deleteConfirm}
        onOpenChange={(o) => !o && setDeleteConfirm(null)}
        title={deleteConfirm ? `Delete “${deleteConfirm.name}”?` : "Delete profile?"}
        description="This removes the profile from the app."
        className="w-[min(520px,94vw)]"
        overlayClassName="bg-black/25 backdrop-blur-md"
        dense
        surface={false}
        contentClassName="rounded-3xl border-white/55 bg-white/80 shadow-[0_22px_70px_rgba(15,23,42,0.22)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.08] dark:shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
        headerClassName="px-4 py-3"
        bodyClassName="overflow-visible"
        footerClassName="border-t border-white/25 bg-white/45 px-4 py-3 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.06]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" className="bg-white/70 dark:bg-white/[0.06]" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="border-red-200/80 bg-red-50/80 text-red-800 hover:bg-red-50 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/55"
              onClick={async () => {
                if (!deleteConfirm) return;
                try {
                  setProfileError(null);
                  await deleteProfileApi(deleteConfirm.id);
                  setDeleteConfirm(null);
                  await refresh();
                } catch (e: unknown) {
                  setProfileError(e instanceof Error ? e.message : "Could not delete profile");
                }
              }}
            >
              <Trash2 data-icon="inline-start" />
              Delete
            </Button>
          </div>
        }
      >
        <div className="px-5 pb-5 pt-3 text-xs text-gray-500 dark:text-gray-400">This can’t be undone.</div>
      </Modal>

      <Modal
        open={addSectionOpen}
        onOpenChange={(o) => {
          setAddSectionOpen(o);
          if (!o) setAddSectionError(null);
        }}
        title="Add this section to:"
        description="Choose whether this section should exist on one profile or across all profiles."
        className="w-[min(520px,94vw)]"
        overlayClassName="bg-black/25 backdrop-blur-md"
        dense
        surface={false}
        contentClassName="rounded-3xl border-white/55 bg-white/80 shadow-[0_22px_70px_rgba(15,23,42,0.22)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.08] dark:shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
        headerClassName="border-b border-white/25 bg-white/45 px-5 py-4 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.06]"
        bodyClassName="overflow-visible bg-transparent"
        footerClassName="border-t border-white/25 bg-white/45 px-5 py-4 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.06]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" className="bg-white/70 dark:bg-white/[0.06]" onClick={() => setAddSectionOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={addSectionBusy || addableOptionalKeys.length === 0}
              onClick={() => void handleConfirmAddSection()}
            >
              {addSectionBusy ? "Adding…" : "Confirm"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 px-5 pb-5 pt-3">
          {addSectionError ? (
            <div className="rounded-xl border border-red-200/70 bg-red-50/80 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {addSectionError}
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Section</label>
            <select
              value={addSectionKey}
              onChange={(e) => setAddSectionKey(e.target.value)}
              className="h-10 w-full rounded-xl border border-gray-200/80 bg-white/70 px-3 text-sm font-medium text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-sm focus:outline-none focus-visible:shadow-focus dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-100"
            >
              {addableOptionalKeys.map((k) => (
                <option key={k} value={k}>
                  {SECTION_LABELS[k] || k}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Add this section to:</label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input
                type="radio"
                name="add-section-scope"
                checked={addSectionScope === "profile"}
                onChange={() => setAddSectionScope("profile")}
              />
              <span>
                This profile only{" "}
                <span className="text-gray-500 dark:text-gray-400">
                  ({profiles.find((p) => p.id === activeProfileId)?.name || "Active profile"})
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input
                type="radio"
                name="add-section-scope"
                checked={addSectionScope === "all"}
                onChange={() => setAddSectionScope("all")}
              />
              <span>All profiles</span>
            </label>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!previewModal}
        onOpenChange={(open) => !open && setPreviewModal(null)}
        title={previewModal ? TEMPLATE_LABELS[previewModal] : "Preview"}
        className="w-[min(900px,96vw)]"
        overlayClassName="bg-black/25 backdrop-blur-md"
        surface={false}
        contentClassName="rounded-3xl border-white/55 bg-white/80 shadow-[0_22px_70px_rgba(15,23,42,0.22)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.08] dark:shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
        headerClassName="border-b border-white/25 bg-white/45 px-5 py-2 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.06]"
        bodyClassName="bg-transparent"
        footerClassName="border-t border-white/25 bg-white/45 px-5 py-3 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.06]"
        footer={
          <p className="text-center text-[11px] text-gray-500 dark:text-gray-400">Sample preview · scroll to see the full page</p>
        }
      >
        {previewModal ? (
          <div className="h-[min(78vh,760px)] min-h-[420px] w-full bg-neutral-200 dark:bg-neutral-700">
            <object
              key={previewModal}
              data={`${SIDECAR}/template-preview-pdf/${previewModal}?v=${PREVIEW_ASSET_VERSION}#toolbar=1&navpanes=0`}
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
