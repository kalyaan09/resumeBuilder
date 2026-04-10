import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ModelPicker from "../components/ModelPicker";
import { getApiKey, setApiKey } from "../lib/secureStore";
import { writeConfig, writeResume, readConfig } from "../lib/persistenceStore";

interface SetupProps {
  onComplete: () => void;
}

type Phase = "model" | "info" | "extracting" | "suggestion";

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

  // Phase state
  const [phase, setPhase] = useState<Phase>("model");

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

  // Load existing model config on mount (pre-fill if user is redoing setup)
  useEffect(() => {
    readConfig().then((stored) => {
      const mc = stored?.modelConfig as Record<string, string> | undefined;
      if (mc?.provider) {
        setModelConfig(mc);
        getApiKey(mc.provider).then((key) => {
          if (key) setApiKeyState(key);
        });
      }
    });
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
      setSuggestion(data);
      setEditTemplate(data.template);
      setEditSections([...data.sections]);
      setUserFeedback("");
      setBackAndForthCount((c) => c + 1);
      setEditMode(false);
    } catch (err: any) {
      setValidateError(err.message || "Unknown error");
    } finally {
      setValidating(false);
    }
  }

  async function handleLooksGood() {
    const finalTemplate = editMode ? editTemplate : suggestion!.template;
    const finalSections = editMode ? editSections : suggestion!.sections;

    await writeConfig({
      setupComplete: true,
      template: finalTemplate,
      role,
      level,
      activeSections: finalSections,
      sectionOrder: finalSections,
      modelConfig: { ...modelConfig },
      savePath: "~/Documents/Resumes",
    });

    await writeResume(extractedResume as Record<string, unknown>);
    await setApiKey(modelConfig!.provider, apiKey);

    onComplete();
    navigate("/editor");
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
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          You've gone back and forth {backAndForthCount} times — this is getting expensive.
          Each call uses your API tokens. Are you sure you want to continue?
        </div>
      );
    }
    if (backAndForthCount >= 7) {
      return (
        <div className="p-3 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 text-sm">
          {backAndForthCount} back-and-forth iterations — each uses your API tokens.
          Consider accepting a suggestion and adjusting manually in the editor.
        </div>
      );
    }
    return (
      <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-700 text-sm">
        {backAndForthCount} iterations — each request uses your API tokens.
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const phaseIndex = { model: 0, info: 1, extracting: 2, suggestion: 2 }[phase];

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-white flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Resume Editor</h1>
          <p className="text-gray-500 mt-1">Set up your workspace — only needed once</p>
        </div>

        {/* Progress steps */}
        <div className="flex items-center gap-2 mb-8">
          {["AI Model", "Your Info", "Template"].map((label, i) => (
            <div key={i} className="flex items-center gap-2 flex-1">
              <div className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${
                    phaseIndex > i
                      ? "bg-green-500 text-white"
                      : phaseIndex === i
                      ? "bg-brand-600 text-white"
                      : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {phaseIndex > i ? "✓" : i + 1}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${phaseIndex === i ? "text-brand-700" : "text-gray-400"}`}>
                  {label}
                </span>
              </div>
              {i < 2 && (
                <div className={`flex-1 h-1 rounded ${phaseIndex > i ? "bg-green-400" : "bg-gray-200"}`} />
              )}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">

          {/* ── Phase: model ── */}
          {phase === "model" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-800 mb-1">Choose your AI model</h2>
                <p className="text-sm text-gray-500">
                  The model extracts your resume and suggests improvements. Pick one and test the connection.
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
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  Connection verified. You're ready to continue.
                </div>
              )}

              <button
                disabled={!modelVerified || !modelConfig}
                onClick={() => setPhase("info")}
                className="w-full py-2.5 bg-brand-600 text-white rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-700 transition-colors"
              >
                Continue →
              </button>
            </div>
          )}

          {/* ── Phase: info ── */}
          {phase === "info" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-800 mb-1">Tell us about you</h2>
                <p className="text-sm text-gray-500">
                  We'll use this to suggest the best resume layout.
                </p>
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Target Role</label>
                <div className="flex flex-wrap gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRole(r)}
                      className={`px-3 py-1.5 rounded-lg text-sm border font-medium transition-all ${
                        role === r
                          ? "bg-brand-600 text-white border-brand-600"
                          : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Level */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Experience Level</label>
                <div className="space-y-2">
                  {LEVELS.map((l) => (
                    <button
                      key={l.value}
                      onClick={() => setLevel(l.value)}
                      className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                        level === l.value
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Resume upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Upload your resume <span className="text-red-500">*</span>
                  <span className="text-gray-400 font-normal ml-1">(.tex, .docx, or .pdf)</span>
                </label>
                <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-brand-400 hover:bg-brand-50 transition-colors">
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
                      <p className="text-brand-600 font-medium">{resumeFile.name}</p>
                      <p className="text-xs text-gray-400 mt-1">Click to change</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-gray-500 text-sm">Drop your resume here</p>
                      <p className="text-xs text-gray-400 mt-1">or click to browse</p>
                    </div>
                  )}
                </label>
              </div>

              {extractError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {extractError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setPhase("model")}
                  className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
                <button
                  disabled={!role || !level || !resumeFile}
                  onClick={handleStartExtraction}
                  className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-700 transition-colors"
                >
                  Extract & Continue →
                </button>
              </div>
            </div>
          )}

          {/* ── Phase: extracting ── */}
          {phase === "extracting" && (
            <div className="flex flex-col items-center justify-center py-12 space-y-6">
              <div className="w-14 h-14 rounded-full border-4 border-brand-200 border-t-brand-600 animate-spin" />
              <div className="text-center">
                <p className="text-gray-800 font-medium">{extractStatus}</p>
                <p className="text-sm text-gray-400 mt-1">This usually takes 15–30 seconds</p>
              </div>
            </div>
          )}

          {/* ── Phase: suggestion ── */}
          {phase === "suggestion" && suggestion && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-800 mb-1">We suggest this layout</h2>
                <p className="text-sm text-gray-500">Based on your role and experience level.</p>
              </div>

              {!editMode ? (
                /* Suggestion card */
                <div className="border border-brand-200 bg-brand-50 rounded-xl p-5 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-brand-500 uppercase tracking-wide">Template</p>
                    <p className="text-lg font-semibold text-gray-900 mt-0.5">
                      {TEMPLATE_LABELS[suggestion.template] || suggestion.template}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-brand-500 uppercase tracking-wide mb-2">Section Order</p>
                    <ol className="space-y-1">
                      {suggestion.sections.map((s, i) => (
                        <li key={s} className="flex items-center gap-2 text-sm text-gray-700">
                          <span className="w-5 h-5 rounded-full bg-brand-200 text-brand-700 text-xs flex items-center justify-center font-semibold flex-shrink-0">
                            {i + 1}
                          </span>
                          {SECTION_LABELS[s] || s}
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="pt-1 border-t border-brand-200">
                    <p className="text-xs text-brand-700 italic">{suggestion.reason}</p>
                  </div>
                </div>
              ) : (
                /* Edit mode */
                <div className="space-y-5">
                  <BackAndForthWarning />

                  {/* Template picker */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Template</label>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(TEMPLATE_LABELS).map(([id, name]) => (
                        <button
                          key={id}
                          onClick={() => setEditTemplate(id)}
                          className={`px-3 py-1.5 rounded-lg text-sm border font-medium transition-all ${
                            editTemplate === id
                              ? "bg-brand-600 text-white border-brand-600"
                              : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                          }`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Section reorder */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Sections (drag to reorder)</label>
                    <div className="space-y-1.5">
                      {editSections.map((s, i) => (
                        <div key={s} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                          <div className="flex flex-col gap-0.5">
                            <button
                              onClick={() => moveSection(i, -1)}
                              disabled={i === 0}
                              className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs leading-none"
                            >
                              ▲
                            </button>
                            <button
                              onClick={() => moveSection(i, 1)}
                              disabled={i === editSections.length - 1}
                              className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs leading-none"
                            >
                              ▼
                            </button>
                          </div>
                          <span className="flex-1 text-sm text-gray-700">{SECTION_LABELS[s] || s}</span>
                          <button
                            onClick={() => removeSection(i)}
                            className="text-gray-300 hover:text-red-500 text-sm transition-colors"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Add section */}
                    {ALL_SECTIONS.filter((s) => !editSections.includes(s)).length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-gray-400 mb-1.5">Add section:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {ALL_SECTIONS.filter((s) => !editSections.includes(s)).map((s) => (
                            <button
                              key={s}
                              onClick={() => addSection(s)}
                              className="px-2.5 py-1 text-xs border border-dashed border-gray-300 text-gray-500 rounded-lg hover:border-brand-400 hover:text-brand-600 transition-colors"
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Tell the AI what to change{" "}
                      <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <textarea
                      rows={3}
                      placeholder="e.g. I prefer FAANGPath template, and want certifications before education"
                      value={userFeedback}
                      onChange={(e) => setUserFeedback(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                    />
                  </div>

                  {validateError && (
                    <p className="text-sm text-red-600">{validateError}</p>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => setEditMode(false)}
                      className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleRevalidate}
                      disabled={validating}
                      className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg font-medium disabled:opacity-50 hover:bg-brand-700 transition-colors"
                    >
                      {validating ? "Asking AI..." : "Re-evaluate →"}
                    </button>
                  </div>
                </div>
              )}

              {/* Action buttons (shown when not in edit mode) */}
              {!editMode && (
                <div className="flex gap-3">
                  <button
                    onClick={() => setEditMode(true)}
                    className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                  >
                    Change it
                  </button>
                  <button
                    onClick={handleLooksGood}
                    className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors"
                  >
                    Looks good! →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
