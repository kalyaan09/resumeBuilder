import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Eraser, Save, Sparkles } from "lucide-react";
import ResumeEditor from "../components/ResumeEditor";
import AppSidebar from "../components/AppSidebar";
import { getApiKey } from "../lib/secureStore";
import { readConfig, readShared, readProfileResume, writeConfig } from "../lib/persistenceStore";
import { getEffectiveSectionOrder } from "../lib/sectionOrder";
import { Button, Modal, SegmentedControl, Surface, TypographyH2, TypographyMuted } from "../ui";
import { useProfiles } from "../context/ProfilesContext";
import type { TransformersContext } from "../lib/sidecarApi";
import { detectBestProfile, detectCompanyType, detectSeniority, extractKeywords, weakBulletIndicesFromResume } from "../lib/jdAnalysis";

const SIDECAR = "http://localhost:8000";
const FONT_SIZES = [9, 9.5, 10, 10.5, 11];

function filterSections(
  resume: Record<string, unknown>,
  sectionOrder: string[],
  activeSections: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of sectionOrder) {
    if (key !== "basics" && activeSections.includes(key) && resume[key] !== undefined) {
      result[key] = resume[key];
    }
  }
  return result;
}

export default function Editor() {
  const navigate = useNavigate();
  const { profiles, activeProfileId, activeProfileName, switchTo } = useProfiles();

  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [sharedData, setSharedData] = useState<Record<string, unknown> | null>(null);
  const [profileResume, setProfileResume] = useState<Record<string, unknown> | null>(null);
  const [masterSections, setMasterSections] = useState<Record<string, unknown> | null>(null);
  const [editedSections, setEditedSections] = useState<Record<string, unknown> | null>(null);
  const [editedResume, setEditedResume] = useState<Record<string, unknown> | null>(null);

  const [jdText, setJdText] = useState("");
  const [profileToast, setProfileToast] = useState<string | null>(null);
  const [transformersContext, setTransformersContext] = useState<TransformersContext>({});
  const [jdAiLoading, setJdAiLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [lastExportPath, setLastExportPath] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const [fontSize, setFontSize] = useState<number>(10);
  const [defaultFontSize, setDefaultFontSize] = useState<number>(10);
  const [fontSizeManual, setFontSizeManual] = useState(false);
  const [fontSizeDialog, setFontSizeDialog] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [overflowWarning, setOverflowWarning] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [cfg, shared] = await Promise.all([readConfig(), readShared()]);
        setConfig(cfg);
        setSharedData(shared);
        const dfSize = (cfg?.defaultFontSize as number) || 10;
        setDefaultFontSize(dfSize);
        setFontSize(dfSize);

        const activeId = (cfg?.activeProfile as string) || null;
        const profile = activeId ? await readProfileResume(activeId) : null;
        setProfileResume(profile);

        if (cfg && profile) {
          const order = getEffectiveSectionOrder(cfg, profile);
          const active = (cfg.activeSections as string[]) || order;
          setMasterSections(filterSections(profile, order, active));
        }
      } finally {
        setDataLoading(false);
      }
    })();
  }, []);

  // When activeProfileId changes externally (Settings switch, auto-detection),
  // reload profile data so profileResume stays in sync and the editor shows the correct content.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (!activeProfileId) return;
    loadProfileData(activeProfileId);
  }, [activeProfileId]);

  useEffect(() => {
    if (!editedResume || !config) return;
    const order = getEffectiveSectionOrder(config, editedResume);
    const active = (config.activeSections as string[]) || order;
    setEditedSections(filterSections(editedResume, order, active));
  }, [editedResume, config]);

  useEffect(() => {
    if (!editedResume || !config) return;
    let cancelled = false;
    setPreviewLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${SIDECAR}/preview-pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resume: editedResume,
            template: (config.template as string) || "jake",
            section_order: getEffectiveSectionOrder(config, editedResume),
            active_sections: (config.activeSections as string[]) || [],
            font_size: fontSize,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || "preview-pdf failed");
        }
        const data = await res.json();
        if (cancelled) return;
        if (typeof data.overflow_warning === "string" && data.overflow_warning) {
          setOverflowWarning(data.overflow_warning);
        } else {
          setOverflowWarning(null);
        }
        const url = `${SIDECAR}/preview-pdf-file?v=${Date.now()}#toolbar=1&navpanes=0&scrollbar=0`;
        setPreviewSrc(url);
      } catch (err) {
        console.error("[preview-pdf]", err);
        if (!cancelled) setOverflowWarning(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [editedResume, fontSize, config]);

  async function loadProfileData(profileId: string) {
    const [shared, profile] = await Promise.all([readShared(), readProfileResume(profileId)]);
    setSharedData(shared);
    setProfileResume(profile);
    setEditedResume(null);
    setEditedSections(null);
    if (config && profile) {
      const order = getEffectiveSectionOrder(config, profile);
      const active = (config.activeSections as string[]) || order;
      setMasterSections(filterSections(profile, order, active));
    }
  }

  async function fullLlmConfig() {
    const base = (config?.modelConfig as Record<string, string>) || {};
    const api_key = await getApiKey(base.provider || "").catch(() => "");
    return { ...base, api_key };
  }

  async function handleEdit() {
    if (!jdText.trim() || !profileResume) return;
    setLoading(true);
    setError(null);

    try {
      const sharedBasics = {
        basics: sharedData?.basics ?? {},
        education: sharedData?.education ?? [],
      };

      const res = await fetch(`${SIDECAR}/edit-resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jd_text: jdText,
          profile_resume: profileResume,
          profile_name: activeProfileName || "",
          basics: sharedBasics,
          shared_education: (sharedData?.education as unknown[]) ?? [],
          user_instructions: (config?.userInstructions as string) || "",
          llm_config: await fullLlmConfig(),
          transformers_context: transformersContext,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Edit failed");
      }

      const data = await res.json();
      // sharedData has basics + education; data.resume has LLM-tailored profile sections
      setEditedResume({ ...(sharedData ?? {}), ...data.resume });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to edit resume");
    } finally {
      setLoading(false);
    }
  }

  function handleSectionChange(key: string, newContent: unknown) {
    setEditedResume((prev) => (prev ? { ...prev, [key]: newContent } : prev));
  }

  function handleResetSection(key: string) {
    const original = profileResume?.[key] ?? sharedData?.[key];
    if (original !== undefined) {
      setEditedResume((prev) => (prev ? { ...prev, [key]: original } : prev));
    }
  }

  async function handleReaskSection(key: string, feedback: string) {
    const res = await fetch(`${SIDECAR}/reask-section`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        section_key: key,
        section_content: editedResume?.[key],
        feedback,
        jd_text: jdText,
        user_instructions: (config?.userInstructions as string) || "",
        llm_config: await fullLlmConfig(),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Re-ask failed");
    }

    const data = await res.json();
    setEditedResume((prev) => (prev ? { ...prev, [key]: data.content } : prev));
  }

  async function doExport(sizeToUse: number) {
    if (!editedResume || !config) return;
    setExportLoading(true);
    setError(null);
    try {
      const res = await fetch(`${SIDECAR}/export-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume: editedResume,
          template: (config?.template as string) || "jake",
          section_order: getEffectiveSectionOrder(config, editedResume),
          active_sections: (config.activeSections as string[]) || [],
          save_path: (config?.savePath as string) || "~/Documents/Resumes",
          font_size: sizeToUse,
          auto_fit: !fontSizeManual,
          profile_id: activeProfileId || "",
          profile_name: activeProfileName || "",
          jd_text: jdText,
          transformers_context: transformersContext,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Export failed");
      }

      const data = await res.json();
      setLastExportPath(data.file_path);

      if (typeof data.font_size === "number" && data.font_size !== fontSize) {
        setFontSize(data.font_size);
      }
      if (typeof data.overflow_warning === "string" && data.overflow_warning) {
        setOverflowWarning(data.overflow_warning);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportLoading(false);
    }
  }

  function handleExportClick() {
    if (!editedResume) return;
    if (fontSizeManual && fontSize !== defaultFontSize) {
      setFontSizeDialog(true);
    } else {
      doExport(fontSize);
    }
  }

  async function handleSaveAsDefault() {
    setFontSizeDialog(false);
    const newDefault = fontSize;
    setDefaultFontSize(newDefault);
    if (config) {
      const updated = { ...config, defaultFontSize: newDefault };
      setConfig(updated);
      await writeConfig(updated).catch(() => {});
    }
    doExport(newDefault);
  }

  function handleJustThisOnce() {
    setFontSizeDialog(false);
    doExport(fontSize);
  }

  async function showInFinder(filePath: string) {
    try {
      await fetch(`${SIDECAR}/open-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });
    } catch {
      /* non-critical */
    }
  }

  const showProfileToast = (msg: string) => {
    setProfileToast(msg);
    window.setTimeout(() => setProfileToast((cur) => (cur === msg ? null : cur)), 3000);
  };

  useEffect(() => {
    if (profiles.length <= 1) return;
    if (jdText.trim().length <= 50) return;
    let cancelled = false;
    setJdAiLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const matchResult = await detectBestProfile(jdText, profiles);
        if (cancelled) return;

        const detectedRole = matchResult.detectedRole;
        const match = matchResult.bestProfile;

        const keywords = extractKeywords(jdText, 10);
        const seniority = detectSeniority(jdText);
        const company_type = detectCompanyType(jdText);
        const weak_bullet_indices = weakBulletIndicesFromResume(jdText, profileResume, 6);
        setTransformersContext({
          detected_role: match?.name ?? matchResult.classifierTopLabel ?? detectedRole ?? undefined,
          keywords,
          must_include_keywords: keywords.slice(0, 10),
          seniority,
          company_type,
          weak_bullet_indices,
        });

        if (match?.id && match.id !== activeProfileId) {
          await switchTo(match.id);
          await loadProfileData(match.id);
          showProfileToast(`Switching to ${match.name} profile`);
        }
      } catch {
        // ignore JD analysis errors (offline / model download blocked)
      } finally {
        if (!cancelled) setJdAiLoading(false);
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      setJdAiLoading(false);
    };
  }, [jdText, profiles, activeProfileId, activeProfileName, switchTo, profileResume]);

  if (dataLoading) {
    return (
      <div className="app-canvas flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (!config?.setupComplete || !profileResume) {
    return (
      <div className="app-canvas flex min-h-screen flex-col">
        <div className="flex flex-1 items-center justify-center p-6">
          <Surface variant="solid" className="w-full max-w-md space-y-4 p-10 text-center">
            <div className="text-4xl opacity-80">📄</div>
            <TypographyH2 className="border-0 pb-0 text-xl text-gray-900 dark:text-gray-100">
              No master resume found
            </TypographyH2>
            <TypographyMuted className="text-sm text-gray-500 dark:text-gray-400">
              Finish setup to import your resume and start tailoring it to each role.
            </TypographyMuted>
            <Button type="button" onClick={() => navigate("/setup")} className="mt-2 w-full">
              Go to setup
            </Button>
          </Surface>
        </div>
      </div>
    );
  }

  return (
    <div className="app-canvas flex h-screen overflow-hidden transition-colors duration-200">
      <AppSidebar active="editor" config={config} />

      <div className="flex min-w-0 flex-1 gap-3 p-3">
        <Surface variant="panel" className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-3xl space-y-8">
              <div>
                {profiles.length > 0 && (
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="relative">
                        <select
                          value={activeProfileId || ""}
                          onChange={async (e) => {
                            const next = e.target.value;
                            if (next && next !== activeProfileId) {
                              try {
                                await switchTo(next);
                                await loadProfileData(next);
                              } catch {
                                // non-fatal
                              }
                            }
                          }}
                          className="h-9 rounded-xl border border-gray-200/80 bg-white/70 px-3 pr-8 text-sm font-medium text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-sm focus:outline-none focus-visible:shadow-focus dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-100"
                        >
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
                          ▾
                        </span>
                      </div>
                      {jdAiLoading ? (
                        <TypographyMuted className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                          <span className="inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-brand-500/80" aria-hidden />
                          Auto-detecting profile…
                        </TypographyMuted>
                      ) : null}
                    </div>

                    {profiles.length > 1 && profileToast ? (
                      <div className="truncate text-xs text-gray-600 dark:text-gray-300">{profileToast}</div>
                    ) : null}
                  </div>
                )}
                {profiles.length > 1 ? (
                  <TypographyMuted className="mb-4 w-full max-w-none text-left text-[11px] leading-snug text-gray-500 dark:text-gray-400">
                    The profile chosen from your job description is a best guess and may be wrong. Please cross-check the profile menu before tailoring.
                  </TypographyMuted>
                ) : null}
                <h2 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">Job description</h2>
                <TypographyMuted className="mt-1.5 max-w-prose text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  Paste the posting. We will match your resume to what they are looking for.
                </TypographyMuted>
                <Surface variant="inset" className="relative mt-4 rounded-xl px-4 py-3">
                  {jdText.trim().length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-2 h-8 w-8 rounded-lg text-gray-500 hover:bg-black/[0.06] hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
                      aria-label="Clear job description"
                      title="Clear"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setJdText("")}
                    >
                      <Eraser />
                    </Button>
                  )}
                  <textarea
                    rows={9}
                    placeholder="Paste the full job description here…"
                    value={jdText}
                    onChange={(e) => setJdText(e.target.value)}
                    className="w-full resize-none bg-transparent pr-10 text-sm leading-relaxed text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-500"
                  />
                </Surface>
                <div className="mx-auto mt-4 flex w-full max-w-md flex-col items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleEdit}
                    disabled={!jdText.trim() || loading || jdAiLoading}
                    className="shrink-0 rounded-btn px-4 py-2 text-sm font-semibold"
                  >
                    <Sparkles data-icon="inline-start" />
                    {loading ? "Tailoring…" : jdAiLoading ? "Auto-detecting…" : "Tailor"}
                  </Button>
                </div>
              </div>

              {/* Divider: darker in light so it’s visible on pale canvas */}
              <div className="h-px bg-black/10 dark:bg-white/10" />

              {loading && (
                <div className="flex flex-col items-center justify-center py-14">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
                  <TypographyMuted className="mt-4">Shaping your experience to fit this role…</TypographyMuted>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/90 p-4 dark:border-red-900/50 dark:bg-red-950/30">
                  <span className="text-red-600 dark:text-red-400">✕</span>
                  <span className="flex-1 text-sm text-red-800 dark:text-red-200">{error}</span>
                  <button type="button" onClick={handleEdit} className="text-sm font-medium text-red-700 underline dark:text-red-300">
                    Retry
                  </button>
                </div>
              )}

              {editedSections && !loading && (
                <div className="space-y-6">
                  <h2 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">Edited resume</h2>
                  <ResumeEditor
                    sections={editedSections}
                    originalSections={masterSections}
                    onSectionChange={handleSectionChange}
                    onReaskSection={handleReaskSection}
                    onResetSection={handleResetSection}
                    label=""
                  />
                </div>
              )}
            </div>
          </div>

        </Surface>

        <Surface variant="panel" className="flex w-[min(44vw,520px)] shrink-0 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1 bg-transparent dark:bg-white/[0.03]">
            {previewSrc && (
              <object
                key={previewSrc}
                data={previewSrc}
                type="application/pdf"
                className="h-full w-full"
                style={{ display: "block", minHeight: "100%" }}
              />
            )}
            <AnimatePresence>
              {previewLoading && (
                <motion.div
                  key="preview-loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className={`absolute inset-0 flex items-center justify-center backdrop-blur-[2px] ${
                    previewSrc ? "bg-white/65 dark:bg-[#1C1C1E]/65" : ""
                  }`}
                >
                  <div className="text-center">
                    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-brand-600" />
                    <TypographyMuted className="mt-3">Updating preview…</TypographyMuted>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {!previewSrc && !previewLoading && (
              <div className="absolute inset-0 flex items-center justify-center p-8">
                <div className="text-center text-gray-500 dark:text-gray-400">
                  <div className="text-5xl opacity-20">📄</div>
                  <p className="mt-3 text-sm">Tailor your resume to see a live preview here.</p>
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 space-y-2.5 border-t border-white/25 px-3 py-3 dark:border-white/10">
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">Font Size</span>
              <div className="flex min-w-0 max-w-full items-center gap-1.5">
                <SegmentedControl
                  className="min-w-0 max-w-[min(268px,100%)]"
                  size="sm"
                  value={String(fontSize)}
                  onChange={(v) => {
                    setFontSize(Number(v));
                    setFontSizeManual(true);
                  }}
                  options={FONT_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
                />
                <span className="shrink-0 text-[13px] font-medium tabular-nums text-gray-500 dark:text-gray-400">pt</span>
              </div>
              {fontSizeManual && fontSize !== defaultFontSize && (
                <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400">≠ saved default</span>
              )}
            </div>

            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleExportClick}
                disabled={!editedResume || exportLoading}
                className="shrink-0 rounded-btn px-4 py-2 text-sm font-semibold sm:self-auto"
              >
                <Save data-icon="inline-start" />
                {exportLoading ? "Saving…" : "Save"}
              </Button>
              {overflowWarning ? (
                <div
                  className="max-w-[min(520px,100%)] rounded-lg bg-amber-50 px-3 py-2 text-left text-[11px] leading-snug text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
                  title={overflowWarning}
                >
                  {overflowWarning}
                </div>
              ) : null}
            </div>

            {lastExportPath && (
              <div className="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="truncate" title={lastExportPath}>
                  Saved: {lastExportPath.split("/").pop()}
                </span>
                <Button type="button" variant="link" size="sm" className="h-auto shrink-0 p-0" onClick={() => showInFinder(lastExportPath)}>
                  Show in Finder
                </Button>
              </div>
            )}
          </div>
        </Surface>
      </div>

      <Modal
        open={fontSizeDialog}
        onOpenChange={setFontSizeDialog}
        title="Font Size Changed"
        className="w-[min(420px,94vw)]"
        overlayClassName="bg-black/25 backdrop-blur-md"
        dense
        surface={false}
        contentClassName="rounded-3xl border-white/55 bg-white/80 shadow-[0_22px_70px_rgba(15,23,42,0.22)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.08] dark:shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
        headerClassName="px-4 py-3"
        bodyClassName="overflow-visible"
      >
        <div className="flex flex-col gap-4 px-5 pb-5 pt-2">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            You changed the font size from <span className="font-semibold">{defaultFontSize}pt</span> to{" "}
            <span className="font-semibold">{fontSize}pt</span>. Save this as your new default, or use it only for this export?
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" onClick={handleSaveAsDefault} className="w-auto min-w-[8.5rem] px-4">
              Save as default
            </Button>
            <Button type="button" variant="secondary" onClick={handleJustThisOnce} className="w-auto min-w-[8.5rem] px-4">
              Just this once
            </Button>
          </div>
          <div className="flex justify-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-fit shrink-0 px-3 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/35 dark:hover:text-red-300"
              onClick={() => setFontSizeDialog(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
