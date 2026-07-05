import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppSidebar from "../components/AppSidebar";
import ResumeEditor from "../components/ResumeEditor";
import SectionOrderEditor from "../components/SectionOrderEditor";
import { readConfig } from "../lib/persistenceStore";
import { SECTION_LABELS, getDefaultSectionOrderFromConfig } from "../lib/sectionOrder";
import { formatAiError } from "../ui/errorFormat";
import { Button, Modal, Surface, TypographyMuted } from "../ui";
import { ArrowLeft, Save, Sparkles } from "lucide-react";
import { getApiKey } from "../lib/secureStore";
import { useProfiles } from "../context/ProfilesContext";
import { getProfileResume, putProfileResume, syncProfile } from "../lib/sidecarApi";
const PROFILE_EDIT_KEYS = ["summary", "experience", "skills", "projects"] as const;
const OPTIONAL_SECTION_KEYS = ["certifications", "publications", "awards", "volunteer", "languages"] as const;
const ALWAYS_VISIBLE_KEYS = [...PROFILE_EDIT_KEYS, ...OPTIONAL_SECTION_KEYS] as const;

interface Suggestion {
  section: string;
  type: "error" | "warning" | "info";
  message: string;
}

function pickEditableSections(full: Record<string, unknown> | null): Record<string, unknown> {
  if (!full) return {};
  const out: Record<string, unknown> = {};
  for (const k of ALWAYS_VISIBLE_KEYS) {
    if (full[k] !== undefined) out[k] = full[k];
  }
  return out;
}

function sectionHasData(data: unknown): boolean {
  if (!data) return false;
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data === "string") return data.trim().length > 0;
  if (typeof data === "object") return Object.keys(data as Record<string, unknown>).length > 0;
  return true;
}

function seedSectionValue(key: string): unknown {
  if (key === "certifications") return [{ name: "", issuer: "", date: "" }];
  if (key === "publications") return [{ title: "", journal: "", date: "", link: "" }];
  if (key === "awards") return [{}];
  if (key === "volunteer") return [{}];
  if (key === "languages") return [{ language: "", fluency: "" }];
  if (key === "projects") return [{ name: "", startDate: "", endDate: "", bullets: [] }];
  if (key === "skills") return [{ category: "", items: [] }];
  if (key === "experience") return [{ company: "", title: "", location: "", startDate: "", endDate: "", bullets: [] }];
  if (key === "summary") return "";
  return [{}];
}

export default function SettingsProfileEdit() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const { profiles, refresh } = useProfiles();

  const profileMeta = useMemo(
    () => profiles.find((p) => p.id === profileId),
    [profiles, profileId]
  );

  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Full profile JSON from server (includes id, name, hidden sections, order flags). */
  const [fullProfile, setFullProfile] = useState<Record<string, unknown> | null>(null);
  const [masterEditable, setMasterEditable] = useState<Record<string, unknown> | null>(null);
  const [editedEditable, setEditedEditable] = useState<Record<string, unknown> | null>(null);

  const [useCustomSectionOrder, setUseCustomSectionOrder] = useState(false);
  const [sectionOrderLocal, setSectionOrderLocal] = useState<string[]>([]);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [reviewPending, setReviewPending] = useState(false);

  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [addSectionKey, setAddSectionKey] = useState<(typeof OPTIONAL_SECTION_KEYS)[number]>("certifications");
  const [addSectionScope, setAddSectionScope] = useState<"profile" | "all">("profile");
  const [addSectionBusy, setAddSectionBusy] = useState(false);
  const [addSectionError, setAddSectionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [cfg, prof] = await Promise.all([readConfig(), getProfileResume(profileId)]);
      setConfig(cfg || {});
      setFullProfile(prof || {});
      const picked = pickEditableSections(prof || {});
      setMasterEditable(picked);
      setEditedEditable({ ...picked });
      const custom = (prof as { useCustomSectionOrder?: boolean })?.useCustomSectionOrder === true;
      setUseCustomSectionOrder(custom);
      const globalOrder = getDefaultSectionOrderFromConfig(cfg || {});
      const po = (prof as { sectionOrder?: string[] })?.sectionOrder;
      setSectionOrderLocal(custom && Array.isArray(po) && po.length > 0 ? [...po] : [...globalOrder]);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Could not load profile");
      setFullProfile(null);
      setEditedEditable(null);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!config) return;
    if (useCustomSectionOrder) return;
    setSectionOrderLocal([...getDefaultSectionOrderFromConfig(config)]);
  }, [config, useCustomSectionOrder]);

  function handleSectionChange(key: string, newContent: unknown) {
    setEditedEditable((prev) => (prev ? { ...prev, [key]: newContent } : prev));
    setDirty(true);
    setReviewPending(true);
    setSuggestions(null);
    setSyncError(null);
  }

  async function fullLlmConfig() {
    const base = (config?.modelConfig as Record<string, string>) || {};
    const api_key = await getApiKey(base.provider || "").catch(() => "");
    return { ...base, api_key };
  }

  function buildPayloadToSave(): Record<string, unknown> | null {
    if (!fullProfile || !editedEditable || !profileId) return null;
    const next: Record<string, unknown> = { ...fullProfile };
    for (const k of ALWAYS_VISIBLE_KEYS) {
      next[k] = editedEditable[k];
    }
    next.id = fullProfile.id ?? profileId;
    next.name = fullProfile.name ?? profileMeta?.name ?? profileId;
    next.useCustomSectionOrder = useCustomSectionOrder;
    if (useCustomSectionOrder) {
      next.sectionOrder = [...sectionOrderLocal];
    } else {
      delete next.sectionOrder;
    }
    return next;
  }

  const addableOptionalKeys = useMemo(() => {
    const cur = editedEditable || {};
    return OPTIONAL_SECTION_KEYS.filter((k) => !sectionHasData(cur[k]));
  }, [editedEditable]);

  const visibleSections = useMemo(() => {
    if (!editedEditable) return null;
    const out: Record<string, unknown> = {};
    for (const k of PROFILE_EDIT_KEYS) {
      // Always show the primary profile sections, even if empty.
      out[k] = editedEditable[k] ?? seedSectionValue(k);
    }
    for (const k of OPTIONAL_SECTION_KEYS) {
      if (sectionHasData(editedEditable[k])) out[k] = editedEditable[k];
    }
    return out;
  }, [editedEditable]);

  async function handleConfirmAddSection() {
    if (!profileId) return;
    setAddSectionBusy(true);
    setAddSectionError(null);
    try {
      if (addSectionScope === "profile") {
        const current = await getProfileResume(profileId);
        const next = { ...(current || {}) } as Record<string, unknown>;
        if (!sectionHasData(next[addSectionKey])) next[addSectionKey] = seedSectionValue(addSectionKey);
        await putProfileResume(profileId, next);
        setFullProfile(next);
        const picked = pickEditableSections(next);
        setMasterEditable(picked);
        setEditedEditable(picked);
        setDirty(true);
      } else {
        await Promise.all(profiles.map(async (p) => {
          const cur = await getProfileResume(p.id);
          const next = { ...(cur || {}) } as Record<string, unknown>;
          if (!sectionHasData(next[addSectionKey])) next[addSectionKey] = seedSectionValue(addSectionKey);
          await putProfileResume(p.id, next);
        }));
        const refreshed = await getProfileResume(profileId);
        setFullProfile(refreshed || {});
        const picked = pickEditableSections((refreshed || {}) as Record<string, unknown>);
        setMasterEditable(picked);
        setEditedEditable({ ...picked });
        setDirty(true);
        await refresh();
      }
      setAddSectionOpen(false);
    } catch (e: unknown) {
      setAddSectionError(e instanceof Error ? e.message : "Could not add section");
    } finally {
      setAddSectionBusy(false);
    }
  }

  async function handleSave() {
    const payload = buildPayloadToSave();
    if (!payload || !profileId) return;
    setSaving(true);
    try {
      await putProfileResume(profileId, payload);
      setFullProfile(payload);
      setMasterEditable(pickEditableSections(payload));
      setDirty(false);
      setReviewPending(false);
      setSuggestions(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await refresh();
    } catch (e: unknown) {
      setSyncError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleReviewByAi() {
    if (!editedEditable || !fullProfile || !profileId) return;
    setSyncing(true);
    setSyncError(null);
    setSuggestions(null);
    try {
      const llm = await fullLlmConfig();
      const resumeAfter = buildPayloadToSave() || { ...fullProfile, ...editedEditable };
      const data = await syncProfile({
        profile_id: profileId,
        resume_before: fullProfile,
        resume_after: resumeAfter,
        role: (config?.role as string) || "",
        level: (config?.level as string) || "",
        llm_config: llm,
      });
      const list = (data.suggestions || []) as Suggestion[];
      setSuggestions(list);
      setReviewPending(false);
    } catch (e: unknown) {
      setSyncError(e instanceof Error ? e.message : "Sync failed");
      setSuggestions(null);
    } finally {
      setSyncing(false);
    }
  }

  function handleResetSection(key: string) {
    if (masterEditable?.[key] !== undefined) {
      setEditedEditable((prev) => (prev ? { ...prev, [key]: masterEditable[key] } : prev));
      setDirty(true);
      setReviewPending(true);
      setSuggestions(null);
    }
  }

  if (!profileId) {
    return null;
  }

  if (!profileMeta && !loading) {
    return (
      <div className="app-canvas flex h-screen flex-col">
        <AppSidebar active="settings" config={config} />
        <div className="flex flex-1 items-center justify-center p-6">
          <TypographyMuted>Profile not found.</TypographyMuted>
          <Button type="button" className="ml-3" variant="secondary" size="sm" onClick={() => navigate("/settings?tab=profiles")}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  const title = profileMeta ? `Edit ${profileMeta.name}` : "Edit profile";

  return (
    <div className="app-canvas flex h-screen overflow-hidden transition-colors duration-200">
      <AppSidebar active="settings" config={config} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-3">
        <Surface variant="panel" className="flex min-w-0 flex-1 flex-col overflow-hidden !shadow-glass dark:!shadow-glass-dark">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200/70 px-6 py-3 dark:border-white/10">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 gap-1.5 px-2"
                onClick={() => navigate("/settings?tab=profiles")}
              >
                <ArrowLeft className="h-4 w-4" />
                Profiles
              </Button>
              <div className="min-w-0">
                <h1 className="truncate text-[17px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">{title}</h1>
                <TypographyMuted className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  Summary, experience, skills, and projects for this profile. Basics and education live under Basic Info.
                </TypographyMuted>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={handleReviewByAi} disabled={syncing || saving || loading}>
                <Sparkles data-icon="inline-start" />
                {syncing ? "Reviewing…" : "Review by AI"}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => void handleSave()} disabled={!dirty || saving || syncing || loading || reviewPending} title={reviewPending ? "Run Review by AI before saving" : undefined}>
                <Save data-icon="inline-start" />
                {saved ? "Saved" : saving ? "Saving…" : reviewPending ? "Review first" : "Save"}
              </Button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {loading ? (
              <div className="flex justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
              </div>
            ) : loadError ? (
              <div className="mx-auto max-w-lg rounded-xl border border-red-200/80 bg-red-50/80 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                {loadError}
              </div>
            ) : editedEditable ? (
              <div className="mx-auto max-w-3xl space-y-6">
                {syncError ? (
                  <Surface variant="inset" className="rounded-xl border border-red-200/80 bg-red-50/80 p-3 dark:border-red-800/60 dark:bg-red-950/35">
                    <div className="text-sm font-semibold text-red-900 dark:text-red-100">{formatAiError(syncError).title}</div>
                    <p className="mt-1 text-xs text-red-800/90 dark:text-red-200/90">{formatAiError(syncError).message}</p>
                  </Surface>
                ) : null}

                {suggestions !== null && suggestions.length > 0 ? (
                  <Surface variant="inset" className="rounded-xl border border-white/40 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.06]">
                    <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">Review · {suggestions.length} note(s)</div>
                    <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">Fix issues below, then Save or run Review by AI again.</p>
                  </Surface>
                ) : null}

                <Surface variant="inset" className="rounded-xl p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      checked={useCustomSectionOrder}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setUseCustomSectionOrder(on);
                        setDirty(true);
                        setReviewPending(true);
                        setSuggestions(null);
                        if (on) {
                          setSectionOrderLocal((cur) =>
                            cur.length ? [...cur] : [...getDefaultSectionOrderFromConfig(config)]
                          );
                        }
                      }}
                    />
                    <span>
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Use custom section order for this profile</span>
                      <TypographyMuted className="mt-0.5 block text-xs">
                        When off, PDF and editor use the global order from Resume Layout settings.
                      </TypographyMuted>
                    </span>
                  </label>
                  {useCustomSectionOrder ? (
                    <div className="mt-4 border-t border-gray-200/60 pt-4 dark:border-white/10">
                      <div className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">Section order (this profile)</div>
                      <TypographyMuted className="mb-2 block text-xs">
                        Use the up and down buttons to reorder sections.
                      </TypographyMuted>
                      <SectionOrderEditor
                        orderedKeys={sectionOrderLocal}
                        onReorder={(next) => {
                          setSectionOrderLocal(next);
                          setDirty(true);
                          setReviewPending(true);
                          setSuggestions(null);
                        }}
                      />
                    </div>
                  ) : null}
                </Surface>

                {addableOptionalKeys.length > 0 ? (
                  <div className="flex items-center justify-between gap-3">
                    <TypographyMuted className="text-xs">
                      Add optional sections to this profile, or to all profiles.
                    </TypographyMuted>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setAddSectionError(null);
                        setAddSectionScope("profile");
                        setAddSectionKey(addableOptionalKeys[0] || "certifications");
                        setAddSectionOpen(true);
                      }}
                    >
                      + Add section
                    </Button>
                  </div>
                ) : null}

                <ResumeEditor
                  sections={visibleSections || editedEditable}
                  originalSections={masterEditable ?? null}
                  onSectionChange={handleSectionChange}
                  onReaskSection={async () => {}}
                  onResetSection={handleResetSection}
                  label="Profile sections"
                  showReask={false}
                  suggestions={suggestions}
                />
              </div>
            ) : null}
          </div>
        </Surface>
      </div>

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
              onChange={(e) => setAddSectionKey(e.target.value as (typeof OPTIONAL_SECTION_KEYS)[number])}
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
                  ({profileMeta?.name || "Active profile"})
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
    </div>
  );
}
