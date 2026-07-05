import { useState, useEffect, useRef, useCallback, useMemo, type Dispatch, type SetStateAction, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Eraser, Save, Sparkles } from "lucide-react";
import ResumeEditor from "../components/ResumeEditor";
import AppSidebar from "../components/AppSidebar";
import { getApiKey } from "../lib/secureStore";
import { readConfig, readShared, readProfileResume, writeConfig } from "../lib/persistenceStore";
import {
  filterTailoredSectionsForEditor,
  getEffectiveActiveSectionsWithData,
  getEffectiveSectionOrder,
} from "../lib/sectionOrder";
import { Button, Modal, SegmentedControl, Surface, TypographyH2, TypographyMuted } from "../ui";
import { formatAiError } from "../ui/errorFormat";
import { cn } from "../ui/cn";
import { useProfiles } from "../context/ProfilesContext";
import { getProfiles, type TransformersContext } from "../lib/sidecarApi";
import { detectBestProfile, detectCompanyType, detectSeniority, extractKeywords, weakBulletIndicesFromResume } from "../lib/jdAnalysis";
import { readErrorDetailFromResponse } from "../lib/httpError";
import { autoFitOnExportEnabled } from "../lib/exportPrefs";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

const SIDECAR = "http://localhost:47372";
const FONT_SIZES = [9, 9.5, 10, 10.5, 11];

const TAILOR_STAGE_LABELS: Record<string, string> = {
  manifest: "Step 1 of 4 — reading your resume…",
  planner: "Step 2 of 4 — planning which bullets to rewrite…",
  navigator: "Step 3 of 4 — rewriting bullets for this role…",
  critic: "Step 4 of 4 — checking facts and consistency…",
  fit: "Fitting your resume onto one page…",
  fallback: "Retrying with a simpler approach…",
};

/**
 * Embedded PDF: Fit = scale page to the iframe viewport (less letterboxing than FitH in a tall panel).
 * FitH + a tall iframe is what caused large gray bands above/below the white page.
 */
const PREVIEW_PDF_HASH = "toolbar=0&navpanes=0&scrollbar=1&view=Fit&page=1";
const PREVIEW_WIDTH_STORAGE_KEY = "editor.previewWidthPx.v1";
const PREVIEW_MIN_W = 360;
const PREVIEW_MAX_W = 580;
const EDITOR_MIN_W = 520;

type EditorGaps = {
  missing_skills?: string[];
  removed_unsupported_skills?: string[];
  added_supported_skills?: string[];
};

type EditorProps = {
  jdText: string;
  setJdText: Dispatch<SetStateAction<string>>;
  editedResume: Record<string, unknown> | null;
  setEditedResume: Dispatch<SetStateAction<Record<string, unknown> | null>>;
  gaps: EditorGaps | null;
  setGaps: Dispatch<SetStateAction<EditorGaps | null>>;
  transformersContext: TransformersContext;
  setTransformersContext: Dispatch<SetStateAction<TransformersContext>>;
};

export default function Editor({
  jdText,
  setJdText,
  editedResume,
  setEditedResume,
  gaps,
  setGaps,
  transformersContext,
  setTransformersContext,
}: EditorProps) {
  const navigate = useNavigate();
  const { profiles, activeProfileId, activeProfileName, switchTo } = useProfiles();

  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [sharedData, setSharedData] = useState<Record<string, unknown> | null>(null);
  const [profileResume, setProfileResume] = useState<Record<string, unknown> | null>(null);
  const [masterSections, setMasterSections] = useState<Record<string, unknown> | null>(null);
  // Derived synchronously — no state/effect needed, avoids blank flash on tab return
  // (was useState+useEffect, which caused a render gap after remount)

  const [profileToast, setProfileToast] = useState<string | null>(null);
  const [jdAiLoading, setJdAiLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tailorStage, setTailorStage] = useState<string | null>(null);
  const [fitNotice, setFitNotice] = useState<string | null>(null);
  const [jdCoverage, setJdCoverage] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [lastExportPath, setLastExportPath] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const [fontSize, setFontSize] = useState<number>(10);
  const [defaultFontSize, setDefaultFontSize] = useState<number>(10);
  const [fontSizeManual, setFontSizeManual] = useState(false);
  const [fontSizeDialog, setFontSizeDialog] = useState(false);
  /** Two iframes: load the next PDF in the hidden one, swap on load (reduces WKWebView flicker). */
  const [previewFrameUrls, setPreviewFrameUrls] = useState<[string | null, string | null]>([null, null]);
  const [visiblePreviewFrame, setVisiblePreviewFrame] = useState<0 | 1>(0);
  const previewCommitRef = useRef(0);
  const pendingCommitByFrameRef = useRef<[number, number]>([-1, -1]);
  const visiblePreviewFrameRef = useRef<0 | 1>(0);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [overflowWarning, setOverflowWarning] = useState<string | null>(null);
  /** Brief animation + message when Save used auto-fit to shrink font (setting on + not manual). */
  const [autoFitFontPulse, setAutoFitFontPulse] = useState(false);
  const [autoFitNotice, setAutoFitNotice] = useState<string | null>(null);
  const previewMeasureRef = useRef<HTMLDivElement>(null);
  const [previewWidthPx, setPreviewWidthPx] = useState<number | null>(null);
  const previewWidthPxRef = useRef<number | null>(null);
  const isResizingRef = useRef(false);
  const editorLayoutRef = useRef<HTMLDivElement>(null);

  // Stable refs so auto-detect can read current values without being in its dep array.
  // Updated in the render body so they are never stale in timers or async callbacks.
  const activeProfileIdRef = useRef<string | null>(activeProfileId);
  activeProfileIdRef.current = activeProfileId;
  const profileResumeRef = useRef(profileResume);
  profileResumeRef.current = profileResume;
  const editedResumeRef = useRef(editedResume);
  editedResumeRef.current = editedResume;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const switchToRef = useRef(switchTo);
  switchToRef.current = switchTo;
  // userOverrideRef: set true when user manually picks a profile; cleared when JD changes substantially.
  const userOverrideRef = useRef(false);
  const overrideJdSnapshotRef = useRef("");
  const prevActiveProfileIdRef = useRef<string | null>(null);
  const loadProfileRequestRef = useRef(0);


  useEffect(() => {
    if (!autoFitFontPulse) return;
    const t = window.setTimeout(() => setAutoFitFontPulse(false), 900);
    return () => window.clearTimeout(t);
  }, [autoFitFontPulse]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREVIEW_WIDTH_STORAGE_KEY);
      if (!raw) return;
      const n = Number(raw);
      if (Number.isFinite(n)) setPreviewWidthPx(Math.min(Math.max(n, PREVIEW_MIN_W), PREVIEW_MAX_W));
    } catch {
      // ignore
    }
  }, []);

  const editedSections = useMemo(
    () => (editedResume && config ? filterTailoredSectionsForEditor(editedResume, config) : null),
    [editedResume, config],
  );

  const previewWidthStyle = useMemo(() => {
    if (previewWidthPx == null) return undefined;
    return { width: previewWidthPx };
  }, [previewWidthPx]);

  useEffect(() => {
    previewWidthPxRef.current = previewWidthPx;
  }, [previewWidthPx]);

  /** If the window narrows, clamp saved preview width so the editor keeps EDITOR_MIN_W. */
  useEffect(() => {
    const container = editorLayoutRef.current;
    if (!container || previewWidthPx == null) return;
    const clampToLayout = () => {
      const containerW = container.getBoundingClientRect().width;
      const maxByEditor = Math.max(PREVIEW_MIN_W, containerW - EDITOR_MIN_W);
      const max = Math.min(PREVIEW_MAX_W, maxByEditor);
      const cur = previewWidthPxRef.current;
      if (cur != null && cur > max) {
        setPreviewWidthPx(max);
        try {
          window.localStorage.setItem(PREVIEW_WIDTH_STORAGE_KEY, String(max));
        } catch {
          /* ignore */
        }
      }
    };
    const ro = new ResizeObserver(() => clampToLayout());
    ro.observe(container);
    clampToLayout();
    return () => ro.disconnect();
  }, [previewWidthPx]);

  const startResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Only start on primary button / touch.
    if (e.button === 2) return;
    const container = (e.currentTarget.parentElement as HTMLDivElement | null);
    const previewEl = container?.querySelector("[data-preview-panel]") as HTMLDivElement | null;
    if (!container || !previewEl) return;

    const handle = e.currentTarget as HTMLDivElement;
    const pointerId = e.pointerId;

    isResizingRef.current = true;
    handle.setPointerCapture(pointerId);
    const startX = e.clientX;
    const startW = previewEl.getBoundingClientRect().width;

    const clampW = (w: number) => {
      const containerW = container.getBoundingClientRect().width;
      const maxByEditor = Math.max(PREVIEW_MIN_W, containerW - EDITOR_MIN_W);
      const max = Math.min(PREVIEW_MAX_W, maxByEditor);
      return Math.min(Math.max(Math.round(w), PREVIEW_MIN_W), max);
    };

    const onMove = (ev: PointerEvent) => {
      if (!isResizingRef.current) return;
      const dx = ev.clientX - startX;
      // Dragging handle right -> smaller preview; left -> larger preview.
      const next = clampW(startW - dx);
      setPreviewWidthPx(next);
    };
    const onUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* ignore if already released */
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try {
        const cur = previewWidthPxRef.current;
        if (cur != null) window.localStorage.setItem(PREVIEW_WIDTH_STORAGE_KEY, String(cur));
      } catch {
        // ignore
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  const onPreviewFrameLoad = useCallback((which: 0 | 1) => {
    const expected = pendingCommitByFrameRef.current[which];
    if (expected !== previewCommitRef.current) return;
    visiblePreviewFrameRef.current = which;
    setVisiblePreviewFrame(which);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        let cfg = await readConfig();
        const shared = await readShared();
        let activeId = (cfg?.activeProfile as string) || null;
        let profile = activeId ? await readProfileResume(activeId) : null;

        // config.activeProfile can be missing or point at a deleted folder while profiles/ still
        // has data. Sidecar GET /profiles resolves that; align local config + reload.
        if (!profile) {
          try {
            const pr = await getProfiles();
            const ids = new Set((pr.profiles || []).map((p) => p.id));
            const resolved =
              typeof pr.activeProfile === "string" && ids.has(pr.activeProfile)
                ? pr.activeProfile
                : pr.profiles?.[0]?.id ?? null;
            if (resolved) {
              profile = await readProfileResume(resolved);
              if (profile) {
                const needsWrite =
                  !cfg ||
                  !cfg.setupComplete ||
                  cfg.activeProfile !== resolved ||
                  !activeId ||
                  (activeId && !ids.has(activeId));
                if (needsWrite) {
                  cfg = { ...(cfg || {}), setupComplete: true, activeProfile: resolved };
                  await writeConfig(cfg).catch(() => {});
                }
              }
            }
          } catch {
            /* sidecar not reachable — keep null profile */
          }
        }

        setConfig(cfg);
        setSharedData(shared);
        const dfSize = (cfg?.defaultFontSize as number) || 10;
        setDefaultFontSize(dfSize);
        setFontSize(dfSize);
        setProfileResume(profile);

        if (cfg && profile) {
          setMasterSections(filterTailoredSectionsForEditor(profile, cfg));
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
    if (!activeProfileId) return;

    const prev = prevActiveProfileIdRef.current;
    prevActiveProfileIdRef.current = activeProfileId;

    const isInitialBind = !didMountRef.current;
    if (isInitialBind) {
      didMountRef.current = true;
      // Never wipe draft on first bind — session restore handles returning from Settings/History.
      loadProfileData(activeProfileId, { resetTailoredDraft: false }).catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load profile")
      );
      return;
    }

    if (prev === activeProfileId) return;
    // If a tailored draft is active, don't wipe it on an automatic profile change.
    // The user's profile dropdown fires loadProfileData(next, resetTailoredDraft:true) directly
    // and is the intended way to switch profiles when a draft exists.
    const hasDraft = editedResumeRef.current != null;
    loadProfileData(activeProfileId, { resetTailoredDraft: !hasDraft }).catch((e) =>
      setError(e instanceof Error ? e.message : "Failed to load profile")
    );
  }, [activeProfileId]);


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
            active_sections: getEffectiveActiveSectionsWithData(config, editedResume),
            font_size: fontSize,
          }),
        });
        if (!res.ok) {
          throw new Error(await readErrorDetailFromResponse(res));
        }
        const data = await res.json();
        if (cancelled) return;
        if (typeof data.overflow_warning === "string" && data.overflow_warning) {
          setOverflowWarning(data.overflow_warning);
        } else {
          setOverflowWarning(null);
        }
        const url = `${SIDECAR}/preview-pdf-file?v=${Date.now()}#${PREVIEW_PDF_HASH}`;
        previewCommitRef.current += 1;
        const c = previewCommitRef.current;
        setPreviewFrameUrls(([a, b]) => {
          if (a === null && b === null) {
            pendingCommitByFrameRef.current[0] = c;
            return [url, null];
          }
          const dormant: 0 | 1 = visiblePreviewFrameRef.current === 0 ? 1 : 0;
          pendingCommitByFrameRef.current[dormant] = c;
          if (dormant === 0) return [url, b];
          return [a, url];
        });
      } catch (err) {
        console.error("[preview-pdf]", err);
        if (!cancelled) setOverflowWarning(err instanceof Error ? `Preview failed: ${err.message}` : "Preview failed");
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [editedResume, fontSize, config]);

  async function loadProfileData(profileId: string, options?: { resetTailoredDraft?: boolean }) {
    const requestId = ++loadProfileRequestRef.current;
    const resetTailoredDraft = options?.resetTailoredDraft ?? false;
    const [shared, profile] = await Promise.all([readShared(), readProfileResume(profileId)]);

    // Stale response — a newer load or tailor finished while we were fetching.
    if (requestId !== loadProfileRequestRef.current) return;

    setSharedData(shared);
    setProfileResume(profile);

    // Don't wipe the draft while a tailoring job is in flight — the poll will overwrite it on completion.
    if (resetTailoredDraft && !loadingRef.current) {
      setEditedResume(null);
      setGaps(null);
      setTransformersContext({});
    }

    if (config && profile) {
      setMasterSections(filterTailoredSectionsForEditor(profile, config));
    }
  }

  function handleJdChange(next: string) {
    setJdText(next);
  }

  function handleClearDraft() {
    setJdText("");
    setEditedResume(null);
    setGaps(null);
    setFitNotice(null);
    setJdCoverage(null);
    setTransformersContext({});
    setError(null);
    setOverflowWarning(null);
    userOverrideRef.current = false;
    overrideJdSnapshotRef.current = "";
  }

  async function fullLlmConfig() {
    const base = (config?.modelConfig as Record<string, string>) || {};
    const api_key = await getApiKey(base.provider || "").catch(() => "");
    return { ...base, api_key };
  }

  async function handleEdit() {
    if (!jdText.trim() || !activeProfileId) return;
    setLoading(true);
    setError(null);
    setGaps(null);

    try {
      // Always read the active profile + shared data at click time to avoid stale-state bugs.
      const [freshShared, freshProfile] = await Promise.all([readShared(), readProfileResume(activeProfileId)]);
      if (!freshProfile) throw new Error("Could not load the active profile resume");
      setSharedData(freshShared);
      setProfileResume(freshProfile);

      const sharedBasics = {
        basics: (freshShared?.basics as Record<string, unknown>) ?? {},
        education: (freshShared?.education as unknown[]) ?? [],
      };

      const editPayload = {
        jd_text: jdText,
        profile_id: activeProfileId,
        profile_resume: freshProfile,
        profile_name: activeProfileName || "",
        basics: sharedBasics,
        shared_education: (freshShared?.education as unknown[]) ?? [],
        user_instructions: (config?.userInstructions as string) || "",
        llm_config: await fullLlmConfig(),
        transformers_context: transformersContext,
      };
      const editInit: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editPayload),
      };

      // Submit job and get job_id immediately (avoids WKWebView 60s timeout)
      const submitRes = await fetch(`${SIDECAR}/edit-resume`, editInit);
      if (!submitRes.ok) throw new Error(await readErrorDetailFromResponse(submitRes));
      const { job_id } = await submitRes.json();

      // Poll until done (3s interval, 10 minute max)
      const POLL_INTERVAL = 3000;
      const deadline = Date.now() + 10 * 60 * 1000;
      let data: Record<string, unknown>;
      while (true) {
        if (Date.now() > deadline) throw new Error("Tailoring timed out after 10 minutes");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        const pollRes = await fetch(`${SIDECAR}/edit-resume/poll/${job_id}`);
        if (!pollRes.ok) throw new Error(pollRes.status === 404 ? "Tailoring job expired — please try again" : await readErrorDetailFromResponse(pollRes));
        const job = await pollRes.json();
        if (job.status === "error") throw new Error(job.message ?? "Tailoring failed");
        if (job.status === "done") { data = job; break; }
        setTailorStage(typeof job.stage === "string" ? job.stage : null);
      }

      // Bump so any in-flight loadProfileData cannot wipe this draft when it completes.
      loadProfileRequestRef.current += 1;
      const merged = { ...(freshShared ?? {}), ...(data.resume as Record<string, unknown>) };
      setEditedResume(merged);
      setFitNotice(typeof data.fit_notice === "string" ? data.fit_notice : null);
      setJdCoverage(typeof data.jd_coverage === "number" ? data.jd_coverage : null);
      if (data.fallback) setError("Pipeline failed — used single-pass fallback. Quality may be lower.");
      if (data && typeof data === "object" && data.gaps) setGaps(data.gaps as EditorGaps);
      try {
        let granted = await isPermissionGranted();
        if (!granted) {
          const perm = await requestPermission();
          granted = perm === "granted";
        }
        if (granted) sendNotification({ title: "Resume tailored", body: "Your resume is ready to review." });
      } catch { /* notification not supported */ }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to edit resume");
    } finally {
      setLoading(false);
      setTailorStage(null);
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
      throw new Error(await readErrorDetailFromResponse(res));
    }

    const data = await res.json();
    setEditedResume((prev) => (prev ? { ...prev, [key]: data.content } : prev));
  }

  async function doExport(sizeToUse: number) {
    if (!editedResume || !config) return;
    setExportLoading(true);
    setError(null);
    const exportUsesAutoFit = autoFitOnExportEnabled(config) && !fontSizeManual;
    try {
      const res = await fetch(`${SIDECAR}/export-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume: editedResume,
          template: (config?.template as string) || "jake",
          section_order: getEffectiveSectionOrder(config, editedResume),
          active_sections: getEffectiveActiveSectionsWithData(config, editedResume),
          save_path: (config?.savePath as string) || "~/Documents/Resumes",
          font_size: sizeToUse,
          auto_fit: exportUsesAutoFit,
          profile_id: activeProfileId || "",
          profile_name: activeProfileName || "",
          jd_text: jdText,
          transformers_context: transformersContext,
        }),
      });

        if (!res.ok) {
          throw new Error(await readErrorDetailFromResponse(res));
        }

      const data = await res.json();
      setLastExportPath(data.file_path);

      const chosen =
        typeof data.font_size === "number" && Number.isFinite(data.font_size) ? data.font_size : sizeToUse;
      if (chosen !== fontSize) {
        setFontSize(chosen);
      }
      if (typeof data.overflow_warning === "string" && data.overflow_warning) {
        setOverflowWarning(data.overflow_warning);
      } else {
        setOverflowWarning(null);
      }

      const shrunk = exportUsesAutoFit && chosen < sizeToUse - 1e-6;
      if (shrunk) {
        setAutoFitFontPulse(true);
        setAutoFitNotice(
          `Saved at ${chosen} pt — auto-fit reduced the font so the PDF fits on one page. Disable “Auto-fit font on Save” in Settings → Resume Layout if you always want the size shown above.`,
        );
        window.setTimeout(() => setAutoFitNotice(null), 10000);
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

    // Clear user override when they paste a substantially different JD (first 100 chars differ).
    if (userOverrideRef.current && jdText.slice(0, 100) !== overrideJdSnapshotRef.current.slice(0, 100)) {
      userOverrideRef.current = false;
    }

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
        const weak_bullet_indices = weakBulletIndicesFromResume(jdText, profileResumeRef.current, 6);
        setTransformersContext({
          detected_role: match?.name ?? matchResult.classifierTopLabel ?? detectedRole ?? undefined,
          keywords,
          must_include_keywords: keywords.slice(0, 10),
          seniority,
          company_type,
          weak_bullet_indices,
        });

        // Skip auto-switch if the user has manually chosen a profile for this JD.
        // Also skip when a tailored draft exists — switching would wipe it.
        if (
          !userOverrideRef.current &&
          !editedResumeRef.current &&
          !loadingRef.current &&
          match?.id &&
          match.id !== activeProfileIdRef.current
        ) {
          await switchToRef.current(match.id);
          await loadProfileData(match.id, { resetTailoredDraft: true });
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
  // Intentionally exclude activeProfileId, switchTo, profileResume — accessed via refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jdText, profiles]);

  if (dataLoading && !editedResume) {
    // Only block with a full-page spinner on first load; returning from Settings/History
    // already has editedResume in memory so we can render immediately.
    return (
      <div className="app-canvas flex min-h-screen items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
        <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p>
      </div>
    );
  }

  // Only show "no resume" after loading is definitively done — not mid-async on remount.
  if (!dataLoading && !profileResume) {
    return (
      <div className="app-canvas flex min-h-screen flex-col">
        <div className="flex flex-1 items-center justify-center p-6">
          <Surface variant="solid" className="w-full max-w-md space-y-4 p-10 text-center">
            <TypographyH2 className="border-0 pb-0 text-xl text-gray-900 dark:text-gray-100">
              No resume found
            </TypographyH2>
            <TypographyMuted className="text-sm text-gray-500 dark:text-gray-400">
              Your resume data could not be loaded. If you just set up the app, try restarting it. Otherwise, go through setup again.
            </TypographyMuted>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => window.location.reload()} className="mt-2 flex-1">
                Reload
              </Button>
              <Button type="button" onClick={() => navigate("/setup")} className="mt-2 flex-1">
                Go to setup
              </Button>
            </div>
          </Surface>
        </div>
      </div>
    );
  }

  return (
    <div className="app-canvas flex h-screen overflow-hidden transition-colors duration-200">
      <AppSidebar active="editor" config={config} />

      <div ref={editorLayoutRef} className="flex min-h-0 min-w-0 flex-1 gap-3 p-3">
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
                              userOverrideRef.current = true;
                              overrideJdSnapshotRef.current = jdText;
                              try {
                                await switchTo(next);
                                await loadProfileData(next, { resetTailoredDraft: true });
                              } catch {
                                // non-fatal
                              }
                            }
                          }}
                          className="h-9 appearance-none rounded-xl border border-gray-200/80 bg-white/70 px-3 pr-8 text-sm font-medium text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-sm focus:outline-none focus-visible:shadow-focus dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-100"
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
                  {(jdText.trim().length > 0 || editedResume) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-2 h-8 w-8 rounded-lg text-gray-500 hover:bg-black/[0.06] hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
                      aria-label="Clear job description and tailored draft"
                      title="Clear JD and tailored draft"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleClearDraft}
                    >
                      <Eraser />
                    </Button>
                  )}
                  <textarea
                    rows={9}
                    placeholder="Paste the full job description here…"
                    value={jdText}
                    onChange={(e) => handleJdChange(e.target.value)}
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
                  <TypographyMuted className="mt-4">
                    {TAILOR_STAGE_LABELS[tailorStage ?? ""] ?? "Shaping your experience to fit this role…"}
                  </TypographyMuted>
                  <TypographyMuted className="mt-2 max-w-sm text-center text-xs leading-snug">
                    This can take a few minutes with slower models. Keep the app open until it finishes.
                  </TypographyMuted>
                </div>
              )}

              {error && (() => {
                const fe = formatAiError(error);
                return (
                  <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/90 p-4 dark:border-red-900/50 dark:bg-red-950/30">
                    <span className="text-red-600 dark:text-red-400">✕</span>
                    <div className="min-w-0 flex-1 text-sm text-red-800 dark:text-red-200">
                      <div className="font-semibold text-red-900 dark:text-red-100">{fe.title}</div>
                      <p className="mt-1 leading-snug">{fe.message}</p>
                      {fe.raw !== fe.message ? (
                        <details className="mt-2 text-[11px] text-red-700/90 dark:text-red-300/90">
                          <summary className="cursor-pointer select-none">Full detail</summary>
                          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono">{fe.raw}</pre>
                        </details>
                      ) : null}
                    </div>
                    <button type="button" onClick={handleEdit} className="shrink-0 text-sm font-medium text-red-700 underline dark:text-red-300">
                      Retry
                    </button>
                  </div>
                );
              })()}

              {gaps && (Array.isArray(gaps.missing_skills) ? gaps.missing_skills.length > 0 : false) && !loading && (
                <Surface variant="inset" className="rounded-xl border border-amber-200/80 bg-amber-50/80 p-4 dark:border-amber-900/50 dark:bg-amber-950/25">
                  <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">Missing skills (not found in your resume)</div>
                  <TypographyMuted className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/90">
                    These appeared in the job description, but weren&apos;t found anywhere in your resume text, so we did not add them automatically.
                  </TypographyMuted>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {gaps.missing_skills!.slice(0, 18).map((s) => (
                      <span
                        key={s}
                        className="rounded-full border border-amber-200/70 bg-white/60 px-2.5 py-1 text-[11px] font-medium text-amber-900 dark:border-amber-800/60 dark:bg-white/[0.06] dark:text-amber-100"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </Surface>
              )}

              {editedSections && !loading && (
                <div className="space-y-6">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">Edited resume</h2>
                    {jdCoverage != null && (
                      <span
                        className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400"
                        title="Share of the job description's key terms that appear in the tailored resume"
                      >
                        JD keyword coverage: {Math.round(jdCoverage * 100)}%
                      </span>
                    )}
                  </div>
                  {fitNotice && (
                    <div className="rounded-lg border border-emerald-200/90 bg-emerald-50 px-3 py-2 text-xs leading-snug text-emerald-950 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-50">
                      {fitNotice}
                    </div>
                  )}
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

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize preview panel"
          onPointerDown={startResize}
          className={cn(
            "group relative -mx-1 w-2 shrink-0 cursor-col-resize select-none touch-none",
            "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-black/10 dark:before:bg-white/10",
            "hover:before:bg-black/20 dark:hover:before:bg-white/20",
          )}
        />

        <Surface
          data-preview-panel
          variant="panel"
          className={cn(
            "flex min-h-0 shrink-0 flex-col self-stretch overflow-hidden",
            previewWidthPx == null && "w-[min(44vw,520px)]",
          )}
          style={previewWidthStyle}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              ref={previewMeasureRef}
              className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-transparent px-0.5 py-2"
            >
              {/*
                Fixed “sheet” viewport (US Letter aspect). It does not grow/shrink with font size.
                PDF #view=Fit scales each page inside this frame; font changes the document only.
              */}
              <div className="relative w-full max-w-full shrink-0 aspect-[8.5/11] overflow-hidden rounded-md bg-neutral-100/90 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:bg-neutral-900/40 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
                {previewFrameUrls[0] ? (
                  <iframe
                    title="Resume PDF preview"
                    src={previewFrameUrls[0]}
                    onLoad={() => onPreviewFrameLoad(0)}
                    className={cn(
                      "absolute inset-0 block h-full w-full border-0 bg-white",
                      visiblePreviewFrame === 0 ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0",
                    )}
                  />
                ) : null}
                {previewFrameUrls[1] ? (
                  <iframe
                    title="Resume PDF preview"
                    src={previewFrameUrls[1]}
                    onLoad={() => onPreviewFrameLoad(1)}
                    className={cn(
                      "absolute inset-0 block h-full w-full border-0 bg-white",
                      visiblePreviewFrame === 1 ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0",
                    )}
                  />
                ) : null}
                <AnimatePresence>
                  {previewLoading && (
                    <motion.div
                      key="preview-loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 backdrop-blur-[2px] dark:bg-neutral-900/55"
                    >
                      <div className="text-center">
                        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-brand-600" />
                        <TypographyMuted className="mt-3">Updating preview…</TypographyMuted>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {!previewFrameUrls[0] && !previewFrameUrls[1] && !previewLoading && (
                  <div className="absolute inset-0 z-[5] flex items-center justify-center bg-white/40 p-6 dark:bg-neutral-950/20">
                    <div className="text-center text-gray-500 dark:text-gray-400">
                      <div className="text-5xl opacity-20">📄</div>
                      <p className="mt-3 text-sm">Tailor your resume to see a live preview here.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="shrink-0 space-y-2.5 border-t border-white/25 px-3 py-3 dark:border-white/10">
            <AnimatePresence>
              {autoFitNotice ? (
                <motion.div
                  key="autofit-notice"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22 }}
                  className="rounded-lg border border-emerald-200/90 bg-emerald-50 px-3 py-2 text-[11px] leading-snug text-emerald-950 shadow-sm dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-50"
                >
                  {autoFitNotice}
                </motion.div>
              ) : null}
            </AnimatePresence>
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">Font Size</span>
              <motion.div
                className="flex min-w-0 max-w-full items-center gap-1.5 rounded-xl"
                animate={
                  autoFitFontPulse
                    ? {
                        scale: [1, 1.055, 1],
                        boxShadow: [
                          "0 0 0 0px rgba(16,185,129,0)",
                          "0 0 0 5px rgba(16,185,129,0.35)",
                          "0 0 0 0px rgba(16,185,129,0)",
                        ],
                      }
                    : {}
                }
                transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
              >
                <SegmentedControl
                  className="min-w-0 max-w-[min(268px,100%)]"
                  size="sm"
                  value={String(fontSize)}
                  onChange={(v) => {
                    setFontSize(Number(v));
                    setFontSizeManual(true);
                    setAutoFitNotice(null);
                  }}
                  options={FONT_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
                />
                <span className="shrink-0 text-[13px] font-medium tabular-nums text-gray-500 dark:text-gray-400">pt</span>
              </motion.div>
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
