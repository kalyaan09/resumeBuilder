import { useState } from "react";
import { useNavigate } from "react-router-dom";

interface SetupProps {
  onComplete: () => void;
}

const EXP_LEVELS = [
  { label: "Student / New Grad (0–1 yrs)", value: "new_grad", pages: 1 },
  { label: "Early Career (1–3 yrs)", value: "early", pages: 1 },
  { label: "Mid-Level (4–8 yrs)", value: "mid", pages: 2 },
  { label: "Senior / Staff (8–12 yrs)", value: "senior", pages: 2 },
  { label: "Executive / Principal (12+ yrs)", value: "exec", pages: 2 },
];

export default function Setup({ onComplete }: SetupProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [expLevel, setExpLevel] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [suggestedPages, setSuggestedPages] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [userInstructions, setUserInstructions] = useState("");
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [researchFile, setResearchFile] = useState<File | null>(null);
  const [savePath, setSavePath] = useState("~/Documents/Resumes");
  const [saving, setSaving] = useState(false);

  function handleExpSelect(value: string) {
    const found = EXP_LEVELS.find((e) => e.value === value);
    setExpLevel(value);
    if (found) {
      setSuggestedPages(found.pages);
      setPageCount(found.pages);
    }
  }

  function handleTemplateUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setTemplateFile(file);
    }
  }

  function handleResearchUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setResearchFile(file);
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Read file contents as base64 for storage
      let templateContent = "";
      let templateName = "";
      if (templateFile) {
        templateContent = await fileToBase64(templateFile);
        templateName = templateFile.name;
      }

      let researchContent = "";
      let researchName = "";
      if (researchFile) {
        researchContent = await fileToBase64(researchFile);
        researchName = researchFile.name;
      }

      const config = {
        setupComplete: true,
        expLevel,
        targetRole,
        pageCount,
        userInstructions,
        templateName,
        templateContent,
        researchName,
        researchContent,
        savePath,
        modelConfig: null,
      };

      localStorage.setItem("resume_editor_config", JSON.stringify(config));
      onComplete();
      navigate("/settings");
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const canProceedStep1 = expLevel && targetRole.trim().length > 0 && pageCount;
  const canProceedStep2 = templateFile !== null;
  const canFinish = canProceedStep1 && canProceedStep2;

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-white flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Resume Editor</h1>
          <p className="text-gray-500 mt-1">Set up your workspace — only needed once</p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                  step >= s
                    ? "bg-brand-600 text-white"
                    : "bg-gray-200 text-gray-500"
                }`}
              >
                {s}
              </div>
              {s < 3 && (
                <div
                  className={`flex-1 h-1 rounded ${
                    step > s ? "bg-brand-600" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {/* Step 1: Experience */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-800 mb-1">
                  Tell us about yourself
                </h2>
                <p className="text-sm text-gray-500">
                  This helps the AI calibrate resume length and tone
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Experience Level
                </label>
                <div className="space-y-2">
                  {EXP_LEVELS.map((level) => (
                    <button
                      key={level.value}
                      onClick={() => handleExpSelect(level.value)}
                      className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                        expLevel === level.value
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <span className="font-medium">{level.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {expLevel && (
                <div className="bg-blue-50 rounded-lg p-4 space-y-3">
                  <p className="text-sm text-blue-700">
                    📄 Based on your experience, we suggest{" "}
                    <strong>{suggestedPages} page{suggestedPages !== 1 ? "s" : ""}</strong>{" "}
                    for your resume. You can adjust this.
                  </p>
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium text-blue-700">
                      Page limit:
                    </label>
                    <div className="flex gap-2">
                      {[1, 2].map((p) => (
                        <button
                          key={p}
                          onClick={() => setPageCount(p)}
                          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                            pageCount === p
                              ? "bg-brand-600 text-white"
                              : "bg-white border border-blue-300 text-blue-700 hover:bg-blue-50"
                          }`}
                        >
                          {p} page{p !== 1 ? "s" : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Target Role / Job Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. Software Engineer, Product Manager, Data Scientist"
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                />
              </div>

              <button
                disabled={!canProceedStep1}
                onClick={() => setStep(2)}
                className="w-full py-2.5 bg-brand-600 text-white rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-700 transition-colors"
              >
                Continue
              </button>
            </div>
          )}

          {/* Step 2: Files */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-800 mb-1">
                  Upload your resume template
                </h2>
                <p className="text-sm text-gray-500">
                  The app will preserve your formatting and fill in AI-edited content
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Resume Template <span className="text-red-500">*</span>
                </label>
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-brand-400 hover:bg-brand-50 transition-colors">
                  <input
                    type="file"
                    accept=".docx,.tex"
                    className="hidden"
                    onChange={handleTemplateUpload}
                  />
                  {templateFile ? (
                    <div className="text-center">
                      <p className="text-brand-600 font-medium">{templateFile.name}</p>
                      <p className="text-xs text-gray-500 mt-1">Click to change</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-gray-500">Drop .docx or .tex file here</p>
                      <p className="text-xs text-gray-400 mt-1">or click to browse</p>
                    </div>
                  )}
                </label>
                {templateFile?.name.endsWith(".tex") && (
                  <p className="text-xs text-blue-600 mt-1">
                    ℹ LaTeX formatting won't be preserved — output will be PDF
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Research File{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-gray-300 transition-colors">
                  <input
                    type="file"
                    accept=".txt,.docx,.pdf,.md"
                    className="hidden"
                    onChange={handleResearchUpload}
                  />
                  {researchFile ? (
                    <div className="text-center">
                      <p className="text-gray-700 font-medium">{researchFile.name}</p>
                      <p className="text-xs text-gray-400 mt-1">Click to change</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-gray-400 text-sm">Background research about you (any LLM-generated file)</p>
                      <p className="text-xs text-gray-400 mt-1">Click to browse</p>
                    </div>
                  )}
                </label>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
                <button
                  disabled={!canProceedStep2}
                  onClick={() => setStep(3)}
                  className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-700 transition-colors"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Preferences */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-800 mb-1">
                  Writing preferences
                </h2>
                <p className="text-sm text-gray-500">
                  Tell the AI how you like your resume written
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Your instructions to the AI
                </label>
                <textarea
                  rows={6}
                  placeholder={`Examples:\n- Always keep my open source contributions section\n- Never use buzzwords like "passionate" or "guru"\n- Prioritize quantified achievements over responsibilities\n- Keep a formal, professional tone`}
                  value={userInstructions}
                  onChange={(e) => setUserInstructions(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Default PDF save location
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={savePath}
                    onChange={(e) => setSavePath(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const { open } = await import("@tauri-apps/plugin-dialog");
                        const selected = await open({ directory: true, multiple: false });
                        if (selected && typeof selected === "string") setSavePath(selected);
                      } catch {
                        // Not in Tauri — user types the path manually
                      }
                    }}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 whitespace-nowrap"
                  >
                    Browse…
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Type a path or click Browse to pick a folder
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
                <button
                  disabled={saving || !canFinish}
                  onClick={handleSave}
                  className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-700 transition-colors"
                >
                  {saving ? "Saving..." : "Finish Setup →"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
