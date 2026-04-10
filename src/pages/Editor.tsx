import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ResumeEditor from "../components/ResumeEditor";
import { getApiKey } from "../lib/secureStore";
import { readConfig, readResume } from "../lib/persistenceStore";

const SIDECAR = "http://localhost:8000";

// Returns an ordered subset of the resume keyed by activeSections.
// `basics` is always excluded — it's rendered in the template header, not the editor.
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

  // Persistent data
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [masterResume, setMasterResume] = useState<Record<string, unknown> | null>(null);

  // Display slices (filtered + ordered)
  const [masterSections, setMasterSections] = useState<Record<string, unknown> | null>(null);
  const [editedSections, setEditedSections] = useState<Record<string, unknown> | null>(null);

  // Full edited JSON Resume (needed for re-ask and export)
  const [editedResume, setEditedResume] = useState<Record<string, unknown> | null>(null);

  // UI state
  const [jdText, setJdText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastExportPath, setLastExportPath] = useState<string | null>(null);
  const [jdCollapsed, setJdCollapsed] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);

  // ── Load config + master resume from disk ──────────────────────────────────

  useEffect(() => {
    Promise.all([readConfig(), readResume()])
      .then(([cfg, resume]) => {
        setConfig(cfg);
        setMasterResume(resume);

        if (cfg && resume) {
          const order = (cfg.sectionOrder as string[]) || Object.keys(resume);
          const active = (cfg.activeSections as string[]) || order;
          setMasterSections(filterSections(resume, order, active));
        }
      })
      .finally(() => setDataLoading(false));
  }, []);

  // Recompute editedSections whenever editedResume or config changes
  useEffect(() => {
    if (!editedResume || !config) return;
    const order = (config.sectionOrder as string[]) || Object.keys(editedResume);
    const active = (config.activeSections as string[]) || order;
    setEditedSections(filterSections(editedResume, order, active));
  }, [editedResume, config]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function fullLlmConfig() {
    const base = (config?.modelConfig as Record<string, string>) || {};
    const api_key = await getApiKey(base.provider || "").catch(() => "");
    return { ...base, api_key };
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 6000);
  }

  // ── Edit ───────────────────────────────────────────────────────────────────

  async function handleEdit() {
    if (!jdText.trim() || !masterResume) return;
    setLoading(true);
    setError(null);
    setJdCollapsed(true);

    try {
      const res = await fetch(`${SIDECAR}/edit-resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jd_text: jdText,
          master_resume: masterResume,
          user_instructions: (config?.userInstructions as string) || "",
          research_text: "",
          llm_config: await fullLlmConfig(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Edit failed");
      }

      const data = await res.json();
      setEditedResume(data.resume);
    } catch (e: any) {
      setError(e.message || "Failed to edit resume");
    } finally {
      setLoading(false);
    }
  }

  // ── Section editing ────────────────────────────────────────────────────────

  function handleSectionChange(key: string, newContent: unknown) {
    setEditedResume((prev) => (prev ? { ...prev, [key]: newContent } : prev));
  }

  function handleResetSection(key: string) {
    if (masterResume?.[key] !== undefined) {
      setEditedResume((prev) => (prev ? { ...prev, [key]: masterResume[key] } : prev));
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

  // ── Export PDF ─────────────────────────────────────────────────────────────
  // Calls the /export-pdf shape that will be implemented in step 5 (Puppeteer).

  async function handleExport() {
    if (!editedResume) return;
    setExportLoading(true);
    setError(null);

    try {
      const res = await fetch(`${SIDECAR}/export-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume: editedResume,
          template: (config?.template as string) || "jake",
          section_order: (config?.sectionOrder as string[]) || [],
          active_sections: (config?.activeSections as string[]) || [],
          save_path: (config?.savePath as string) || "~/Documents/Resumes",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Export failed");
      }

      const data = await res.json();
      setLastExportPath(data.file_path);
      showToast(`Saved to ${data.file_path}`);
    } catch (e: any) {
      setError(e.message || "Export failed");
    } finally {
      setExportLoading(false);
    }
  }

  async function showInFinder(filePath: string) {
    try {
      await fetch(`${SIDECAR}/open-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });
    } catch {
      // Non-critical
    }
  }

  // ── Gates ──────────────────────────────────────────────────────────────────

  if (dataLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  if (!config?.setupComplete || !masterResume) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-6 py-3">
          <h1 className="text-lg font-semibold text-gray-800">Resume Editor</h1>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-10 max-w-md w-full text-center space-y-4">
            <div className="text-4xl">📄</div>
            <h2 className="text-xl font-semibold text-gray-800">No master resume found</h2>
            <p className="text-sm text-gray-500">
              Complete the setup flow to extract your resume and configure your AI model.
            </p>
            <button
              onClick={() => navigate("/setup")}
              className="mt-2 px-6 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors"
            >
              Go to Setup
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top nav */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-gray-800">Resume Editor</h1>
        <div className="ml-auto flex items-center gap-3">
          {editedSections && (
            <button
              onClick={handleExport}
              disabled={exportLoading}
              className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {exportLoading ? "Exporting..." : "Export PDF"}
            </button>
          )}
          <button
            onClick={() => navigate("/settings")}
            className="px-4 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
          >
            Settings
          </button>
        </div>
      </div>

      <div className="flex-1 max-w-5xl mx-auto w-full p-6 space-y-6">

        {/* JD input */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div
            className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-gray-50"
            onClick={() => setJdCollapsed(!jdCollapsed)}
          >
            <h2 className="font-semibold text-gray-800">Job Description</h2>
            <span className="text-gray-400 text-sm">{jdCollapsed ? "▶ Expand" : "▼ Collapse"}</span>
          </div>
          {!jdCollapsed && (
            <div className="px-5 pb-5 space-y-3">
              <textarea
                rows={8}
                placeholder="Paste the full job description here..."
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm resize-none"
              />
              <button
                onClick={handleEdit}
                disabled={!jdText.trim() || loading}
                className="w-full py-2.5 bg-brand-600 text-white rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-700 transition-colors"
              >
                {loading ? "Editing resume..." : "Tailor My Resume"}
              </button>
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center space-y-3">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600 mx-auto" />
              <p className="text-gray-500 text-sm">AI is tailoring your resume to the job description...</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
            <span className="text-red-600">✕</span>
            <span className="text-sm text-red-800 flex-1">{error}</span>
            <button onClick={handleEdit} className="text-red-600 underline text-sm">
              Retry
            </button>
          </div>
        )}

        {/* Edited resume sections */}
        {editedSections && !loading && (
          <ResumeEditor
            sections={editedSections}
            originalSections={masterSections}
            onSectionChange={handleSectionChange}
            onReaskSection={handleReaskSection}
            onResetSection={handleResetSection}
          />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-3">
          <span>{toast}</span>
          {lastExportPath && (
            <button
              onClick={() => showInFinder(lastExportPath)}
              className="underline opacity-80 hover:opacity-100 whitespace-nowrap"
            >
              Show in Finder
            </button>
          )}
        </div>
      )}
    </div>
  );
}
