import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ModelPicker from "../components/ModelPicker";
import { RoleCombobox } from "../components/RoleCombobox";
import { getApiKey, setApiKey } from "../lib/secureStore";
import { writeConfig, writeShared, writeProfileResume, readConfig } from "../lib/persistenceStore";
import { applyTheme, Theme } from "../lib/themeStore";
import { useConnection } from "../context/ConnectionContext";
import { useProfiles } from "../context/ProfilesContext";
import { createProfile, getProfileResume, putShared, getProfiles } from "../lib/sidecarApi";
import { readErrorDetailFromResponse } from "../lib/httpError";
import SectionOrderEditor from "../components/SectionOrderEditor";
import { Button, Modal, SegmentedControl, Surface, TypographyMuted } from "../ui";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";

interface SetupProps {
  onComplete: () => void;
}

type Phase = "theme" | "model" | "info" | "extracting" | "suggestion";

const SIDECAR = "http://localhost:47372";
/** Bust WebView cache for embedded template PDFs (keep in sync with Settings PREVIEW_ASSET_VERSION). */
const TEMPLATE_PREVIEW_V = 8;

const LEVELS = [
  { value: "entry", label: "New Grad / Entry (0–2 yrs)" },
  { value: "junior", label: "Junior (2–4 yrs)" },
  { value: "mid", label: "Mid-Level (4+ yrs)" },
];

const TEMPLATE_LABELS: Record<string, string> = {
  jake: "Jake's Resume",
  faangpath: "FAANGPath",
  sb2nov: "RenderCV (sb2nov)",
  myresume: "My Resume",
};

const ALL_SECTIONS = [
  "summary", "experience", "education", "skills", "projects",
  "certifications", "publications", "awards", "volunteer", "languages",
];

const SECTION_LABELS: Record<string, string> = {
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  projects: "Projects",
  certifications: "Certifications",
  publications: "Publications",
  awards: "Awards",
  volunteer: "Volunteer",
  languages: "Languages",
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Setup({ onComplete }: SetupProps) {
  const navigate = useNavigate();
  const { backendReady, backendConnecting } = useConnection();
  const { profiles } = useProfiles();

  useEffect(() => {
    if (profiles.length > 0) {
      onComplete();
      navigate("/editor", { replace: true });
    }
  }, [profiles.length, navigate, onComplete]);

  const [phase, setPhase] = useState<Phase>("theme");
  const [selectedTheme, setSelectedTheme] = useState<Theme>("system");

  // Model config state
  const [modelConfig, setModelConfig] = useState<Record<string, string> | null>(null);
  const [apiKey, setApiKeyState] = useState("");
  const [modelVerified, setModelVerified] = useState(false);

  // Info phase state
  const [role, setRole] = useState("");
  const [level, setLevel] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);

  // Extraction state
  const [extractStatus, setExtractStatus] = useState("");
  const [extractError, setExtractError] = useState("");

  // Suggestion state
  const [suggestion, setSuggestion] = useState<{ template: string; sections: string[]; reason: string } | null>(null);
  const [originalSuggestion, setOriginalSuggestion] = useState<{ template: string; sections: string[]; reason: string } | null>(null);
  const [editTemplate, setEditTemplate] = useState("");
  const [editSections, setEditSections] = useState<string[]>([]);
  const [userFeedback, setUserFeedback] = useState("");
  const [backAndForthCount, setBackAndForthCount] = useState(0);
  const [validating, setValidating] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [validateError, setValidateError] = useState("");
  const [llmWarning, setLlmWarning] = useState<string | null>(null);
  const [previewModal, setPreviewModal] = useState<string | null>(null);
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);

  useEffect(() => {
    readConfig().then((stored) => {
      const mc = stored?.modelConfig as Record<string, string> | undefined;
      if (mc?.provider) {
        setModelConfig(mc);
        getApiKey(mc.provider).then((key) => {
          if (key) setApiKeyState(key);
        });
      }
      const t = (stored?.theme as Theme) || "system";
      setSelectedTheme(t);
    });
  }, []);

  /** Live preview: apply selection on the setup page (Light / Dark / System). */
  useEffect(() => {
    applyTheme(selectedTheme);
  }, [selectedTheme]);

  useEffect(() => {
    return () => {
      readConfig().then((c) => applyTheme(((c?.theme as Theme) || "system")));
    };
  }, []);

  // ── Model phase ────────────────────────────────────────────────────────────

  function handleModelChange(config: Record<string, string>) {
    setModelConfig(config);
    setModelVerified(false);
  }

  function handleApiKeyChange(key: string) {
    setApiKeyState(key);
    setModelVerified(false);
  }

  // ── Info phase ─────────────────────────────────────────────────────────────

  async function handleStartExtraction() {
    if (!resumeFile || !role || !level || !modelConfig) {
      return;
    }

    setExtractError("");
    setPhase("extracting");

    try {
      setExtractStatus("Reading your resume file...");
      const base64 = await fileToBase64(resumeFile);
      const llm_config = { ...modelConfig, api_key: apiKey };

      // Step 1: Extract resume content (preview only; profile is created on "Looks good!")
      setExtractStatus("Extracting resume content with AI (15–30s)...");
      const extractRes = await fetch("http://localhost:47372/extract-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_content: base64, file_name: resumeFile.name, llm_config }),
      });

      if (!extractRes.ok) {
        throw new Error(await readErrorDetailFromResponse(extractRes));
      }

      await extractRes.json();

      // Step 2: Get template + section suggestion
      setExtractStatus("Selecting best template and section layout...");
      const validateRes = await fetch("http://localhost:47372/validate-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, level, llm_config }),
      });

      if (!validateRes.ok) {
        throw new Error(await readErrorDetailFromResponse(validateRes));
      }

      const validateData = await validateRes.json();
      setSuggestion(validateData);
      setOriginalSuggestion(validateData);
      setEditTemplate(validateData.template);
      setEditSections([...validateData.sections]);
      setPhase("suggestion");
    } catch (err: any) {
      setExtractError(err.message || "Unknown error occurred");
      setPhase("info");
    }
  }

  // ── Suggestion phase ───────────────────────────────────────────────────────

  async function handleRevalidate() {
    if (!modelConfig) return;
    setValidating(true);
    setValidateError("");
    setLlmWarning(null);
    try {
      const llm_config = { ...modelConfig, api_key: apiKey };
      const res = await fetch("http://localhost:47372/validate-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          level,
          current_template: editTemplate,
          current_sections: editSections,
          user_feedback: userFeedback,
          llm_config,
        }),
      });

      if (!res.ok) {
        throw new Error(await readErrorDetailFromResponse(res));
      }

      const data = await res.json();
      setUserFeedback("");
      setBackAndForthCount((c) => c + 1);

      const templateDiffers = data.template !== editTemplate;
      const sectionsDiffer = JSON.stringify(data.sections) !== JSON.stringify(editSections);

      if (templateDiffers || sectionsDiffer) {
        // LLM disagrees: store its suggestion for reference but never override user's choices
        setSuggestion(data);
        setLlmWarning(data.reason || "AI suggests a different layout for your role.");
        // editTemplate and editSections intentionally NOT updated
      } else {
        // LLM agrees with the user's choice
        setSuggestion(data);
        setEditTemplate(data.template);
        setEditSections([...data.sections]);
      }
    } catch (err: any) {
      setValidateError(err.message || "Unknown error");
    } finally {
      setValidating(false);
    }
  }

  async function handleLooksGood() {
    const finalTemplate = editTemplate;
    const finalSections = editSections;

    if (!resumeFile || !modelConfig) {
      setExtractError("Setup state lost. Please go back and re-upload your resume.");
      return;
    }

    setSavingProfile(true);
    setExtractError("");

    try {
      const llm_config = { ...modelConfig, api_key: apiKey };

      // Step 1: Create profile (extracts resume, creates profile dir, writes shared.json)
      const profile = await createProfile({ name: role, resumeFile, llm_config });

      // Step 2: Fetch merged resume to get basics + education for shared.json
      const mergedResume = await getProfileResume(profile.id);

      // Step 3: Explicitly write basics + education to shared.json via PUT /shared
      const sharedData: Record<string, unknown> = {};
      if (mergedResume.basics) sharedData.basics = mergedResume.basics;
      if (mergedResume.education) sharedData.education = mergedResume.education;
      await putShared(sharedData);

      // Step 4: Write config with activeProfile + template/layout choices
      const existing = (await readConfig()) || {};
      const nextConfig = {
        ...existing,
        theme: ((existing as Record<string, unknown>).theme as Theme | undefined) ?? selectedTheme,
        setupComplete: true,
        template: finalTemplate,
        role,
        level,
        activeSections: finalSections,
        sectionOrder: finalSections,
        defaultSectionOrder: finalSections,
        modelConfig: { ...modelConfig },
        savePath: "~/Documents/Resumes",
        activeProfile: profile.id,
      };
      await writeConfig(nextConfig);

      // Step 4b: Mirror shared + profile data into localStorage for dev-mode fallback
      // (Tauri FS writes fail silently in browser; sidecar files aren't accessible via FS API)
      const profileData: Record<string, unknown> = Object.fromEntries(
        Object.entries(mergedResume).filter(([k]) => k !== "basics" && k !== "education")
      );
      await Promise.all([writeShared(sharedData), writeProfileResume(profile.id, profileData)]);

      // Step 5: Verify profile exists before navigating (best-effort; don't block on network blip)
      const verifyResult = await getProfiles().catch(() => null);
      if (verifyResult && verifyResult.profiles.length === 0) {
        throw new Error("Profile verification failed: GET /profiles returned 0 profiles");
      }

      // Step 6: Save API key
      await setApiKey(modelConfig.provider, apiKey);

      applyTheme((nextConfig.theme as Theme) || "system");
      onComplete();
      navigate("/editor");
    } catch (err: unknown) {
      setExtractError("Could not save: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingProfile(false);
    }
  }

  // ── Section reorder helpers ────────────────────────────────────────────────

  function addSection(name: string) {
    if (!editSections.includes(name)) {
      setEditSections((s) => [...s, name]);
    }
  }

  // ── Back-and-forth warning ─────────────────────────────────────────────────

  function BackAndForthWarning() {
    if (backAndForthCount < 5) return null;
    if (backAndForthCount >= 10) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          You have tried many revisions ({backAndForthCount}). Each one uses your chosen provider. Want to pause and
          fine-tune the layout in the editor instead?
        </div>
      );
    }
    if (backAndForthCount >= 7) {
      return (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
          {backAndForthCount} revisions so far. Each uses your provider. You can accept a layout and tweak details later
          in settings.
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {backAndForthCount} revisions. Each uses your provider account.
      </div>
    );
  }

  const setupStep =
    phase === "theme"
      ? 1
      : phase === "model"
        ? 2
        : phase === "info" || phase === "extracting"
          ? 3
          : 4;

  return (
    <div className="app-canvas flex min-h-screen items-center justify-center p-6 text-gray-900">
      <div
        className={
          phase === "theme"
            ? "w-full max-w-md"
            : "w-full max-w-[980px] lg:min-w-[800px]"
        }
      >
        <div className={`text-center ${phase === "theme" ? "mb-6" : "mb-8"}`}>
          <div className="mb-4 flex justify-center">
            <img src="/app_icon.png" alt="" className="h-14 w-14 rounded-2xl shadow-card" width={56} height={56} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Welcome to Resume Pro</h1>
          <TypographyMuted className="mt-2 text-sm text-gray-500">
            A quick setup, then you are ready to tailor your resume for every role.
          </TypographyMuted>
        </div>

        <Surface
          variant="panel"
          className={
            phase === "theme"
              ? "border-white/40 bg-white/70 p-6 !shadow-glass backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:!shadow-glass-dark sm:p-7"
              : "border-white/40 bg-white/70 p-8 !shadow-glass backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:!shadow-glass-dark lg:p-10"
          }
        >
          <TypographyMuted
            className={`text-center text-xs font-medium uppercase tracking-wider text-gray-400 ${
              phase === "theme" ? "mb-5" : "mb-6"
            }`}
          >
            Step {setupStep} of 4
          </TypographyMuted>

          {phase === "theme" && (
            <div className="mx-auto w-full max-w-sm space-y-5 text-center">
              <div>
                <h2 className="mb-1 text-xl font-semibold text-gray-900 dark:text-gray-100">Choose your look</h2>
                <TypographyMuted className="text-sm text-gray-500 dark:text-gray-400">
                  Pick a theme for the app. You can change it anytime in Settings.
                </TypographyMuted>
              </div>
              <SegmentedControl<Theme>
                size="sm"
                value={selectedTheme}
                onChange={setSelectedTheme}
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "system", label: "System" },
                ]}
              />
              <div className="flex w-full justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="w-fit px-4 font-semibold"
                  onClick={async () => {
                    try {
                      const prev = (await readConfig()) || {};
                      await writeConfig({ ...prev, theme: selectedTheme });
                    } catch {
                      // non-critical: theme defaults to system on next launch
                    }
                    setPhase("model");
                  }}
                >
                  <ArrowRight data-icon="inline-start" />
                  Continue
                </Button>
              </div>
            </div>
          )}

          {phase === "model" && (
            <div className="space-y-6">
              <div>
                <h2 className="mb-1 text-xl font-semibold text-gray-900 dark:text-gray-100">Connect your assistant</h2>
                <TypographyMuted className="text-sm text-gray-500 dark:text-gray-400">
                  Choose who helps read your resume and suggest wording. Run a quick check to be sure it responds.
                </TypographyMuted>
              </div>

              <ModelPicker
                value={modelConfig as any}
                apiKey={apiKey}
                onChange={handleModelChange}
                onApiKeyChange={handleApiKeyChange}
                onTestSuccess={() => setModelVerified(true)}
              />

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                <Button type="button" variant="secondary" size="xs" className="w-full sm:w-auto px-4" onClick={() => setPhase("theme")}>
                  <ArrowLeft data-icon="inline-start" />
                  Back
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="w-full sm:w-auto px-4"
                  disabled={!modelVerified || !modelConfig}
                  onClick={() => setPhase("info")}
                >
                  <ArrowRight data-icon="inline-start" />
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* ── Phase: info ── */}
          {phase === "info" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-1">Tell us about you</h2>
                <TypographyMuted className="text-sm text-gray-500 dark:text-gray-400">
                  We'll use this to suggest the best resume layout.
                </TypographyMuted>
              </div>

              <RoleCombobox value={role} onChange={setRole} label="Target Role" inputId="setup-role-input" />

              {/* Level */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Experience Level</label>
                <div className="flex flex-wrap gap-2">
                  {LEVELS.map((l) => (
                    <button
                      key={l.value}
                      onClick={() => setLevel(l.value)}
                      className={`px-3 py-1.5 rounded-lg text-sm border font-medium transition-all ${
                        level === l.value
                          ? "bg-brand-600 text-white border-brand-600"
                          : "bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500"
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Resume upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Upload your resume <span className="text-red-500">*</span>
                  <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">(.tex, .docx, or .pdf)</span>
                </label>
                <label className="flex flex-col items-center justify-center w-full h-28 rounded-xl border border-dashed border-gray-300/90 bg-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-sm transition-colors hover:border-brand-400 hover:bg-brand-50/60 dark:border-white/12 dark:bg-white/[0.04] dark:hover:bg-brand-900/18 cursor-pointer">
                  <input
                    type="file"
                    accept=".tex,.docx,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setResumeFile(f);
                    }}
                  />
                  {resumeFile ? (
                    <div className="text-center">
                      <p className="text-brand-600 dark:text-brand-400 font-medium">{resumeFile.name}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Click to change</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-gray-600 dark:text-gray-300 text-sm font-medium">Drop your resume here</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">or click to browse</p>
                    </div>
                  )}
                </label>
              </div>

              {/* Profile info callout */}
              <div className="flex items-start gap-2.5 rounded-xl border border-sky-200/70 bg-sky-50/60 px-3.5 py-3 text-sm text-sky-800 backdrop-blur-sm dark:border-sky-500/20 dark:bg-sky-950/30 dark:text-sky-200">
                <span className="mt-px shrink-0 text-base leading-none" aria-hidden>&#x2139;&#xFE0F;</span>
                <span>
                  <span className="font-medium">This becomes your first profile.</span>{" "}
                  You can create up to 3 later, one per role you’re targeting (e.g. Backend, DE, AI/ML).
                </span>
              </div>

              {extractError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
                  {extractError}
                </div>
              )}

              {backendConnecting && !backendReady && (
                <div className="flex items-center gap-2 rounded-xl border border-sky-200/80 bg-sky-50/80 p-3 text-sm text-sky-800 backdrop-blur-sm dark:border-sky-500/20 dark:bg-sky-950/30 dark:text-sky-200">
                  <div className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-sky-400 border-t-sky-700" />
                  Getting things ready on your Mac. First launch can take up to a minute.
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                <Button type="button" variant="secondary" size="xs" className="w-full sm:w-auto px-4" onClick={() => setPhase("model")}>
                  <ArrowLeft data-icon="inline-start" />
                  Back
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="w-full sm:w-auto px-4 font-semibold"
                  disabled={!role || !level || !resumeFile || !backendReady}
                  onClick={handleStartExtraction}
                >
                  <ArrowRight data-icon="inline-start" />
                  {backendConnecting && !backendReady ? "Almost ready…" : "Continue"}
                </Button>
              </div>
            </div>
          )}

          {/* ── Phase: extracting ── */}
          {phase === "extracting" && (
            <div className="flex flex-col items-center justify-center py-12 space-y-6">
              <div className="w-14 h-14 rounded-full border-4 border-brand-200 border-t-brand-600 animate-spin" />
              <div className="text-center">
                <p className="text-gray-800 dark:text-gray-100 font-medium">{extractStatus}</p>
                <TypographyMuted className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  This usually takes 15–30 seconds
                </TypographyMuted>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPhase("info")}>
                Cancel
              </Button>
            </div>
          )}

          {/* ── Phase: suggestion ── */}
          {phase === "suggestion" && suggestion && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-1">We suggest this layout</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Based on your role and experience level.</p>
              </div>

              {extractError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
                  {extractError}
                </div>
              )}

              {/* Single professional page: always editable, no mode switching */}
              <div className="space-y-5">
                <BackAndForthWarning />

                  <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
                    {/* Template (selected) */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Template</label>
                        <Button type="button" variant="secondary" size="xs" className="font-semibold" onClick={() => setTemplatesModalOpen(true)}>
                          View all templates
                        </Button>
                      </div>
                      <div
                        className="group relative overflow-hidden rounded-xl border border-gray-200/80 bg-white/70 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.06]"
                        style={{ aspectRatio: "8.5/11" }}
                      >
                        <iframe
                          title="Selected template preview"
                          src={`${SIDECAR}/template-preview-pdf/${editTemplate || suggestion.template}?v=${TEMPLATE_PREVIEW_V}#toolbar=0&navpanes=0&scrollbar=0`}
                          className="block h-full w-full border-0 bg-white"
                          style={{ width: "100%", height: "100%", pointerEvents: "none" }}
                        />
                        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 border-t border-black/10 bg-white/88 px-3 py-2 text-xs backdrop-blur-md dark:border-white/15 dark:bg-black/55">
                          <span className="truncate font-medium text-gray-800 dark:text-gray-100">
                            {TEMPLATE_LABELS[editTemplate || suggestion.template] || (editTemplate || suggestion.template)}
                          </span>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-7 px-2 text-[11px] bg-white/90 dark:bg-white/[0.16] dark:text-gray-100"
                            onClick={() => setPreviewModal(editTemplate || suggestion.template)}
                          >
                            Preview
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Section reorder */}
                    <div>
                      <div className="mb-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Section Order</label>
                        <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                          Use the up and down buttons to reorder (works reliably in the desktop app).
                        </p>
                      </div>
                      <SectionOrderEditor
                        orderedKeys={editSections}
                        onReorder={setEditSections}
                        onRemove={(key) => setEditSections((rows) => rows.filter((k) => k !== key))}
                        canRemove={() => true}
                      />

                      {/* Add section */}
                      {ALL_SECTIONS.filter((s) => !editSections.includes(s)).length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Add section:</p>
                          <div className="flex flex-wrap gap-1.5">
                            {ALL_SECTIONS.filter((s) => !editSections.includes(s)).map((s) => (
                              <button
                                key={s}
                                onClick={() => addSection(s)}
                                className="px-2.5 py-1 text-xs border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded-lg hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                              >
                                + {SECTION_LABELS[s] || s}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {llmWarning && (
                        <div
                          className="mt-3 rounded-xl border border-amber-200/90 bg-amber-50/90 p-3 text-sm shadow-[0_8px_24px_rgba(180,83,9,0.12)] backdrop-blur-sm dark:border-amber-800/80 dark:bg-amber-950/50 dark:shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
                          role="status"
                        >
                          <p className="font-medium text-amber-900 dark:text-amber-200">
                            AI note: your layout may not match typical advice for this role.
                          </p>
                          <p className="mt-1.5 text-xs leading-relaxed text-amber-800/95 dark:text-amber-300/95">
                            {llmWarning}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Feedback */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Tell the AI what to change{" "}
                      <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
                    </label>
                    <textarea
                      rows={3}
                      placeholder="e.g. I prefer FAANGPath template, and want certifications before education"
                      value={userFeedback}
                      onChange={(e) => setUserFeedback(e.target.value)}
                      className="w-full resize-none rounded-xl border border-gray-200/80 bg-white/70 px-3 py-2 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-sm focus:outline-none focus-visible:shadow-focus dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-100"
                    />
                  </div>

                  {validateError && (
                    <p className="text-sm text-red-600 dark:text-red-400">{validateError}</p>
                  )}

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <TypographyMuted className="text-[11px] italic text-gray-500 dark:text-gray-400">
                        {suggestion.reason}
                      </TypographyMuted>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => {
                            const orig = originalSuggestion || suggestion;
                            setEditTemplate(orig.template);
                            setEditSections([...orig.sections]);
                            setSuggestion(orig);
                            setLlmWarning(null);
                            setUserFeedback("");
                            setValidateError("");
                          }}
                        >
                          Reset
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-8 px-3"
                          onClick={handleRevalidate}
                          disabled={validating}
                        >
                          {validating ? "Asking…" : "Re-evaluate"}
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-between">
                      <Button type="button" variant="secondary" size="xs" className="w-full sm:w-auto px-4" onClick={() => setPhase("info")}>
                        <ArrowLeft data-icon="inline-start" />
                        Back
                      </Button>
                      <Button type="button" variant="secondary" size="xs" className="w-full sm:w-auto px-4 font-semibold" onClick={handleLooksGood} disabled={savingProfile}>
                        {savingProfile ? (
                          <span className="flex items-center gap-2">
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Creating profile…
                          </span>
                        ) : (
                          <>
                            <Check data-icon="inline-start" />
                            Looks good! →
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
              </div>
            </div>
          )}
        </Surface>
      </div>

      <Modal
        open={!!previewModal}
        onOpenChange={(open) => !open && setPreviewModal(null)}
        title={previewModal ? `${TEMPLATE_LABELS[previewModal]}: sample preview` : "Preview"}
        className="w-[min(760px,96vw)]"
        bodyClassName="min-h-0 overflow-y-auto"
        footer={
          <p className="text-center text-xs text-gray-500 dark:text-gray-400">
            Generated with sample data. Your resume will use your actual content
          </p>
        }
      >
        {previewModal ? (
          <div className="h-[min(78vh,760px)] min-h-[420px] w-full overflow-y-auto bg-neutral-200 dark:bg-neutral-700">
            <iframe
              key={previewModal}
              title={`${TEMPLATE_LABELS[previewModal]} sample preview`}
              src={`${SIDECAR}/template-preview-pdf/${previewModal}?v=${TEMPLATE_PREVIEW_V}#toolbar=1&navpanes=0&scrollbar=1`}
              className="h-full min-h-[min(78vh,760px)] w-full border-0 bg-white"
              style={{ display: "block" }}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={templatesModalOpen}
        onOpenChange={setTemplatesModalOpen}
        title="Choose a template"
        description="These are sample previews. Your resume content stays the same."
        className="w-[min(980px,96vw)]"
        dense
        surface={false}
        overlayClassName="bg-black/25"
        contentClassName="rounded-3xl border-white/55 bg-white/80 shadow-[0_22px_70px_rgba(15,23,42,0.22)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.08] dark:shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
        bodyClassName="overflow-y-auto"
      >
        <div className="p-5">
          <div className="grid grid-cols-2 gap-4">
            {Object.entries(TEMPLATE_LABELS).map(([id, name]) => {
              const selected = (editTemplate || suggestion?.template) === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setEditTemplate(id);
                    if (suggestion) setSuggestion({ ...suggestion, template: id });
                    setTemplatesModalOpen(false);
                  }}
                  className={`group relative overflow-hidden rounded-2xl border-2 text-left transition-all ${
                    selected ? "border-[#2563EB]" : "border-gray-200 hover:border-gray-300 dark:border-white/10 dark:hover:border-white/20"
                  }`}
                >
                  {selected ? (
                    <div className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-[#2563EB] text-white shadow-md">
                      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 12 12" aria-hidden>
                        <path d="M10 3L5 8.5 2 5.5l-1 1 4 4 6-7-1-1z" />
                      </svg>
                    </div>
                  ) : null}
                  <div className="relative overflow-hidden bg-white" style={{ aspectRatio: "8.5/11" }}>
                    <iframe
                      title={`${name} template`}
                      src={`${SIDECAR}/template-preview-pdf/${id}?v=${TEMPLATE_PREVIEW_V}#toolbar=0&navpanes=0&scrollbar=0`}
                      className="block h-full w-full border-0 bg-white"
                      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
                    />
                  </div>
                  <div className={`flex items-center justify-between px-3 py-2 ${selected ? "bg-brand-50 dark:bg-brand-900/20" : "bg-white dark:bg-[#2C2C2E]"}`}>
                    <span className={`truncate text-xs font-medium ${selected ? "text-brand-700 dark:text-brand-400" : "text-gray-700 dark:text-gray-300"}`}>
                      {name}
                    </span>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">Select</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </Modal>
    </div>
  );
}
