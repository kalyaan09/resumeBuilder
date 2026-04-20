import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ModelPicker from "../components/ModelPicker";
import { getApiKey, setApiKey } from "../lib/secureStore";
import { writeConfig, writeResume, readConfig } from "../lib/persistenceStore";
import { applyTheme, Theme } from "../lib/themeStore";
import { useConnection } from "../context/ConnectionContext";
import { Button, Modal, SegmentedControl, Surface } from "../ui";

interface SetupProps {
  onComplete: () => void;
}

type Phase = "theme" | "model" | "info" | "extracting" | "suggestion";

const ROLES = [
  "SDE", "DE", "ML Engineer", "Data Scientist", "Data Analyst",
  "PM", "BA", "TPM", "DevOps", "Other",
];

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
  const [extractedResume, setExtractedResume] = useState<Record<string, any> | null>(null);

  // Suggestion state
  const [suggestion, setSuggestion] = useState<{ template: string; sections: string[]; reason: string } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editTemplate, setEditTemplate] = useState("");
  const [editSections, setEditSections] = useState<string[]>([]);
  const [userFeedback, setUserFeedback] = useState("");
  const [backAndForthCount, setBackAndForthCount] = useState(0);
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState("");
  const [llmWarning, setLlmWarning] = useState<string | null>(null);
  const [previewModal, setPreviewModal] = useState<string | null>(null);

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

  useEffect(() => {
    document.documentElement.classList.remove("dark");
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
    if (!resumeFile || !role || !level || !modelConfig) return;
    setExtractError("");
    setPhase("extracting");

    try {
      setExtractStatus("Reading your resume file...");
      const base64 = await fileToBase64(resumeFile);
      const llm_config = { ...modelConfig, api_key: apiKey };

      setExtractStatus("Extracting resume content with AI (15–30s)...");
      const extractRes = await fetch("http://localhost:8000/extract-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_content: base64,
          file_name: resumeFile.name,
          llm_config,
        }),
      });

      if (!extractRes.ok) {
        const err = await extractRes.json();
        throw new Error(err.detail || "Extraction failed");
      }

      const extractData = await extractRes.json();
      setExtractedResume(extractData.resume);

      setExtractStatus("Selecting best template and section layout...");
      const validateRes = await fetch("http://localhost:8000/validate-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, level, llm_config }),
      });

      if (!validateRes.ok) {
        const err = await validateRes.json();
        throw new Error(err.detail || "Template validation failed");
      }

      const validateData = await validateRes.json();
      setSuggestion(validateData);
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
      const res = await fetch("http://localhost:8000/validate-template", {
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
        const err = await res.json();
        throw new Error(err.detail || "Validation failed");
      }

      const data = await res.json();
      setUserFeedback("");
      setBackAndForthCount((c) => c + 1);

      const templateDiffers = data.template !== editTemplate;
      const sectionsDiffer = JSON.stringify(data.sections) !== JSON.stringify(editSections);

      if (templateDiffers || sectionsDiffer) {
        // LLM disagrees — store its suggestion for reference but never override user's choices
        setSuggestion(data);
        setLlmWarning(data.reason || "AI suggests a different layout for your role.");
        // editTemplate and editSections intentionally NOT updated
      } else {
        // LLM agrees with the user's choice
        setSuggestion(data);
        setEditTemplate(data.template);
        setEditSections([...data.sections]);
        setEditMode(false);
      }
    } catch (err: any) {
      setValidateError(err.message || "Unknown error");
    } finally {
      setValidating(false);
    }
  }

  function handleProceedWithMyChoice() {
    // Lock in user's current editTemplate/editSections as the final suggestion
    setSuggestion((s) => s ? { ...s, template: editTemplate, sections: [...editSections] } : s);
    setLlmWarning(null);
    setEditMode(false);
  }

  async function handleLooksGood() {
    const finalTemplate = editMode ? editTemplate : suggestion!.template;
    const finalSections = editMode ? editSections : suggestion!.sections;

    try {
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
        modelConfig: { ...modelConfig! },
        savePath: "~/Documents/Resumes",
      };
      await writeConfig(nextConfig);

      await writeResume(extractedResume as Record<string, unknown>);
      await setApiKey(modelConfig!.provider, apiKey);

      applyTheme((nextConfig.theme as Theme) || "system");
      onComplete();
      navigate("/editor");
    } catch (err: unknown) {
      setExtractError("Could not save: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ── Section reorder helpers ────────────────────────────────────────────────

  function moveSection(idx: number, dir: -1 | 1) {
    const next = [...editSections];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setEditSections(next);
  }

  function removeSection(idx: number) {
    setEditSections((s) => s.filter((_, i) => i !== idx));
  }

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
          {backAndForthCount} revisions so far — each uses your provider. You can accept a layout and tweak details later
          in settings.
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {backAndForthCount} revisions — each uses your provider account.
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
    <div
      className="flex min-h-screen items-center justify-center bg-gradient-to-br from-sky-50 via-blue-50/30 to-white p-6 text-gray-900"
      onClick={() => previewModal && setPreviewModal(null)}
    >
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <img src="/app_icon.png" alt="" className="h-14 w-14 rounded-2xl shadow-card" width={56} height={56} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Welcome to Resume Pro</h1>
          <p className="mt-2 text-sm text-gray-500">A quick setup — then you are ready to tailor your resume for every role.</p>
        </div>

        <Surface variant="solid" className="border-gray-100/80 p-8 shadow-card">
          <p className="mb-6 text-center text-xs font-medium uppercase tracking-wider text-gray-400">
            Step {setupStep} of 4
          </p>

          {phase === "theme" && (
            <div className="space-y-6">
              <div>
                <h2 className="mb-1 text-xl font-semibold text-gray-900">Choose your look</h2>
                <p className="text-sm text-gray-500">Pick a theme for after setup. This screen stays bright so it is easy to read.</p>
              </div>
              <SegmentedControl<Theme>
                value={selectedTheme}
                onChange={setSelectedTheme}
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "system", label: "System" },
                ]}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full rounded-btn py-3 text-sm font-semibold"
                onClick={async () => {
                  const prev = (await readConfig()) || {};
                  await writeConfig({ ...prev, theme: selectedTheme });
                  setPhase("model");
                }}
              >
                Continue
              </Button>
            </div>
          )}

          {phase === "model" && (
            <div className="space-y-6">
              <div>
                <h2 className="mb-1 text-xl font-semibold text-gray-900">Connect your assistant</h2>
                <p className="text-sm text-gray-500">
                  Choose who helps read your resume and suggest wording. Run a quick check to be sure it responds.
                </p>
              </div>

              <ModelPicker
                value={modelConfig as any}
                apiKey={apiKey}
                onChange={handleModelChange}
                onApiKeyChange={handleApiKeyChange}
                onTestSuccess={() => setModelVerified(true)}
              />

              {modelVerified && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  Nice — we heard back from your provider. You can continue.
                </div>
              )}

              <div className="flex gap-3">
                <Button type="button" variant="secondary" size="sm" className="flex-1 rounded-btn" onClick={() => setPhase("theme")}>
                  Back
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="flex-1 rounded-btn"
                  disabled={!modelVerified || !modelConfig}
                  onClick={() => setPhase("info")}
                >
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
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  We'll use this to suggest the best resume layout.
                </p>
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Target Role</label>
                <div className="flex flex-wrap gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRole(r)}
                      className={`px-3 py-1.5 rounded-lg text-sm border font-medium transition-all ${
                        role === r
                          ? "bg-brand-600 text-white border-brand-600"
                          : "bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Level */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Experience Level</label>
                <div className="space-y-2">
                  {LEVELS.map((l) => (
                    <button
                      key={l.value}
                      onClick={() => setLevel(l.value)}
                      className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                        level === l.value
                          ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-400"
                          : "border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500"
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
                <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors">
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
                      <p className="text-gray-500 dark:text-gray-400 text-sm">Drop your resume here</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">or click to browse</p>
                    </div>
                  )}
                </label>
              </div>

              {extractError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
                  {extractError}
                </div>
              )}

              {backendConnecting && !backendReady && (
                <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                  <div className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-sky-400 border-t-sky-700" />
                  Getting things ready on your Mac — first launch can take up to a minute.
                </div>
              )}

              <div className="flex gap-3">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setPhase("model")}>
                  Back
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={!role || !level || !resumeFile || !backendReady}
                  onClick={handleStartExtraction}
                >
                  {backendConnecting && !backendReady ? "Almost ready…" : "Import resume & continue"}
                </Button>
              </div>
            </div>
          )}

          {/* ── Phase: extracting ── */}
          {phase === "extracting" && (
            <div className="flex flex-col items-center justify-center py-12 space-y-6">
              <div className="w-14 h-14 rounded-full border-4 border-brand-200 border-t-brand-600 animate-spin" />
              <div className="text-center">
                <p className="text-gray-800 dark:text-gray-200 font-medium">{extractStatus}</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">This usually takes 15–30 seconds</p>
              </div>
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

              {!editMode ? (
                /* Suggestion card */
                <div className="border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-900/20 rounded-xl p-5 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wide">Template</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {TEMPLATE_LABELS[suggestion.template] || suggestion.template}
                      </p>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs font-medium"
                        onClick={() => setPreviewModal(suggestion.template)}
                      >
                        Preview
                      </Button>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wide mb-2">Section Order</p>
                    <ol className="space-y-1">
                      {suggestion.sections.map((s, i) => (
                        <li key={s} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                          <span className="w-5 h-5 rounded-full bg-brand-200 dark:bg-brand-800 text-brand-700 dark:text-brand-300 text-xs flex items-center justify-center font-semibold flex-shrink-0">
                            {i + 1}
                          </span>
                          {SECTION_LABELS[s] || s}
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="pt-1 border-t border-brand-200 dark:border-brand-800">
                    <p className="text-xs text-brand-700 dark:text-brand-400 italic">{suggestion.reason}</p>
                  </div>
                </div>
              ) : (
                /* Edit mode */
                <div className="space-y-5">
                  <BackAndForthWarning />

                  {/* Template picker */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Template</label>
                    <div className="grid grid-cols-2 gap-3">
                      {Object.entries(TEMPLATE_LABELS).map(([id, name]) => (
                        <div
                          key={id}
                          onClick={() => setEditTemplate(id)}
                          className={`relative cursor-pointer rounded-xl border-2 overflow-hidden transition-all ${
                            editTemplate === id
                              ? "border-brand-600 ring-2 ring-brand-200 dark:ring-brand-800"
                              : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                          }`}
                        >
                          {/* Thumbnail — PDF scaled down via CSS transform */}
                          <div className="relative bg-white overflow-hidden group" style={{ height: "160px" }}>
                            <div style={{
                              position: "absolute", top: 0, left: 0,
                              width: "816px", height: "1056px",
                              transformOrigin: "top left", transform: "scale(0.35)",
                              pointerEvents: "none",
                            }}>
                              <object
                                data={`http://localhost:8000/template-preview-pdf/${id}`}
                                type="application/pdf"
                                style={{ width: "816px", height: "1056px", display: "block" }}
                              />
                            </div>
                            {/* Hover overlay */}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewModal(id);
                                }}
                                className="pointer-events-auto rounded-full px-3 py-1.5 text-xs font-semibold opacity-0 shadow-md transition-opacity group-hover:opacity-100"
                              >
                                View full preview
                              </Button>
                            </div>
                          </div>
                          {/* Label bar */}
                          <div className={`px-3 py-2 flex items-center justify-between ${editTemplate === id ? "bg-brand-50 dark:bg-brand-900/20" : "bg-white dark:bg-gray-800"}`}>
                            <span className={`text-xs font-medium truncate ${editTemplate === id ? "text-brand-700 dark:text-brand-400" : "text-gray-700 dark:text-gray-300"}`}>
                              {name}
                            </span>
                            {editTemplate === id && (
                              <span className="w-4 h-4 rounded-full bg-brand-600 flex items-center justify-center flex-shrink-0 ml-1">
                                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                                  <path d="M10 3L5 8.5 2 5.5l-1 1 4 4 6-7-1-1z"/>
                                </svg>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Section reorder */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Sections (drag to reorder)</label>
                    <div className="space-y-1.5">
                      {editSections.map((s, i) => (
                        <div key={s} className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                          <div className="flex flex-col gap-0.5">
                            <button
                              onClick={() => moveSection(i, -1)}
                              disabled={i === 0}
                              className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-20 text-xs leading-none"
                            >
                              ▲
                            </button>
                            <button
                              onClick={() => moveSection(i, 1)}
                              disabled={i === editSections.length - 1}
                              className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-20 text-xs leading-none"
                            >
                              ▼
                            </button>
                          </div>
                          <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{SECTION_LABELS[s] || s}</span>
                          <button
                            onClick={() => removeSection(i)}
                            className="text-gray-300 dark:text-gray-600 hover:text-red-500 text-sm transition-colors"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>

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
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                    />
                  </div>

                  {validateError && (
                    <p className="text-sm text-red-600 dark:text-red-400">{validateError}</p>
                  )}

                  {/* LLM disagrees with user's choice — warn but never override */}
                  {llmWarning && (
                    <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 space-y-2.5">
                      <p className="text-sm text-amber-900 dark:text-amber-300">
                        <span className="font-semibold">AI suggests this may not be optimal for your role</span>
                        {" — but you can proceed anyway."}
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-400 italic">{llmWarning}</p>
                      <Button
                        type="button"
                        onClick={handleProceedWithMyChoice}
                        className="w-full bg-amber-600 py-2 text-sm font-semibold hover:bg-amber-700"
                      >
                        Proceed with my choice →
                      </Button>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="secondary"
                      className="flex-1"
                      onClick={() => {
                        setEditMode(false);
                        setLlmWarning(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="button" className="flex-1" onClick={handleRevalidate} disabled={validating}>
                      {validating ? "Asking AI..." : "Re-evaluate →"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Action buttons (shown when not in edit mode) */}
              {!editMode && (
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1"
                    onClick={() => {
                      setEditMode(true);
                      setLlmWarning(null);
                    }}
                  >
                    Change it
                  </Button>
                  <Button type="button" className="flex-1" onClick={handleLooksGood}>
                    Looks good! →
                  </Button>
                </div>
              )}
            </div>
          )}
        </Surface>
      </div>

      <Modal
        open={!!previewModal}
        onOpenChange={(open) => !open && setPreviewModal(null)}
        title={previewModal ? `${TEMPLATE_LABELS[previewModal]} — Sample preview` : "Preview"}
        className="w-[min(760px,96vw)]"
        footer={
          <p className="text-center text-xs text-gray-500 dark:text-gray-400">
            Generated with sample data — your resume will use your actual content
          </p>
        }
      >
        {previewModal ? (
          <div className="h-[min(78vh,760px)] min-h-[420px] w-full bg-neutral-200 dark:bg-neutral-700">
            <object
              key={previewModal}
              data={`http://localhost:8000/template-preview-pdf/${previewModal}#toolbar=1&navpanes=0`}
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
