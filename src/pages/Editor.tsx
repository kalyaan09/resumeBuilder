import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ResumeEditor from "../components/ResumeEditor";
import { getApiKey } from "../lib/secureStore";

const SIDECAR_URL = "http://localhost:8000";

export default function Editor() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<any>(null);
  const [jdText, setJdText] = useState("");
  const [sections, setSections] = useState<any>(null);
  const [originalSections, setOriginalSections] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [texExportLoading, setTexExportLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [jdCollapsed, setJdCollapsed] = useState(false);
  const [lastExportPath, setLastExportPath] = useState<string | null>(null);
  const [researchText, setResearchText] = useState<string>("");
  const [templateLoading, setTemplateLoading] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("resume_editor_config");
    if (raw) {
      const parsed = JSON.parse(raw);
      setConfig(parsed);
      // Auto-parse template on load
      if (parsed.templateContent && parsed.templateName) {
        parseTemplate(parsed);
      }
      // Parse research file once — extract plain text, don't re-send base64 on every call
      if (parsed.researchContent && parsed.researchName) {
        parseResearch(parsed);
      }
    }
  }, []);

  async function parseResearch(cfg: any) {
    try {
      const res = await fetch(`${SIDECAR_URL}/parse-research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_content: cfg.researchContent,
          file_name: cfg.researchName,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setResearchText(data.text || "");
    } catch {
      // Non-critical — editing still works without research context
    }
  }

  async function parseTemplate(cfg: any) {
    setTemplateLoading(true);
    try {
      const res = await fetch(`${SIDECAR_URL}/parse-resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_content: cfg.templateContent,
          file_name: cfg.templateName,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setOriginalSections(data.sections);
    } catch (e: any) {
      console.error("Failed to parse template:", e);
    } finally {
      setTemplateLoading(false);
    }
  }

  async function handleEdit() {
    if (!jdText.trim()) return;
    setLoading(true);
    setError(null);
    setJdCollapsed(true);

    try {
      const res = await fetch(`${SIDECAR_URL}/edit-resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jd_text: jdText,
          resume_sections: originalSections,
          user_instructions: config?.userInstructions || "",
          research_text: researchText,
          page_count: config?.pageCount || 1,
          target_role: config?.targetRole || "",
          llm_config: await fullLlmConfig(),
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSections(data.sections);
    } catch (e: any) {
      setError(e.message || "Failed to edit resume");
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    setExportLoading(true);
    try {
      const res = await fetch(`${SIDECAR_URL}/export-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sections,
          original_sections: originalSections,
          template_content: config?.templateContent,
          template_name: config?.templateName,
          save_path: config?.savePath || "~/Documents",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setLastExportPath(data.file_path);
      setToast(`✓ Saved to ${data.file_path}`);
      setTimeout(() => setToast(null), 6000);
    } catch (e: any) {
      setError(e.message || "Export failed");
    } finally {
      setExportLoading(false);
    }
  }

  async function handleTexExport() {
    setTexExportLoading(true);
    try {
      const res = await fetch(`${SIDECAR_URL}/export-tex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sections,
          original_sections: originalSections,
          template_content: config?.templateContent,
          template_name: config?.templateName,
          save_path: config?.savePath || "~/Documents",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setLastExportPath(data.edited_path);
      setToast(`✓ Saved .tex to ${data.edited_path}`);
      setTimeout(() => setToast(null), 6000);
    } catch (e: any) {
      setError(e.message || "Export failed");
    } finally {
      setTexExportLoading(false);
    }
  }

  async function handleReaskSection(sectionKey: string, feedback: string) {
    try {
      const res = await fetch(`${SIDECAR_URL}/reask-section`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section_key: sectionKey,
          section_content: sections[sectionKey],
          feedback,
          jd_text: jdText,
          user_instructions: config?.userInstructions || "",
          llm_config: await fullLlmConfig(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSections((prev: any) => ({ ...prev, [sectionKey]: data.content }));
    } catch (e: any) {
      throw new Error(e.message || "Failed to re-ask");
    }
  }

  async function showInFinder(filePath: string) {
    try {
      await fetch(`${SIDECAR_URL}/open-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });
    } catch {
      // Ignore — non-critical
    }
  }

  function handleResetSection(sectionKey: string) {
    if (originalSections?.[sectionKey] !== undefined) {
      setSections((prev: any) => ({
        ...prev,
        [sectionKey]: originalSections[sectionKey],
      }));
    }
  }

  function handleSectionChange(sectionKey: string, newContent: any) {
    setSections((prev: any) => ({ ...prev, [sectionKey]: newContent }));
  }

  async function fullLlmConfig() {
    const base = config?.modelConfig || {};
    const api_key = await getApiKey(base.provider || "").catch(() => "");
    return { ...base, api_key };
  }

  const modelReady = !!config?.modelTested;

  // Hard gate — must have a verified model before using the editor
  if (config && !modelReady) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-800">Resume Editor</h1>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-10 max-w-md w-full text-center space-y-4">
            <div className="text-4xl">⚠</div>
            <h2 className="text-xl font-semibold text-gray-800">No AI model connected</h2>
            <p className="text-sm text-gray-500">
              You need to configure and successfully test an AI model before you can edit your resume.
            </p>
            <button
              onClick={() => navigate("/settings")}
              className="mt-2 px-6 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors"
            >
              Go to Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top nav */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-gray-800">Resume Editor</h1>
        <div className="ml-auto flex items-center gap-3">
          {sections && (
            <>
              <button
                onClick={handleTexExport}
                disabled={texExportLoading || !config?.templateName?.endsWith(".tex")}
                className="px-4 py-1.5 bg-gray-700 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
              >
                {texExportLoading ? "Exporting..." : "Export .tex"}
              </button>
              <button
                onClick={handleExport}
                disabled={exportLoading}
                className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {exportLoading ? "Exporting..." : "Export PDF"}
              </button>
            </>
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

        {/* JD Input */}
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
                disabled={!jdText.trim() || loading || !originalSections}
                className="w-full py-2.5 bg-brand-600 text-white rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-700 transition-colors"
              >
                {loading ? "Editing resume..." : "Edit My Resume"}
              </button>
              {!originalSections && (
                <p className="text-xs text-gray-400 text-center flex items-center justify-center gap-2">
                  {templateLoading && (
                    <span className="inline-block w-3 h-3 border border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                  )}
                  {templateLoading ? "Parsing template..." : "Waiting for template to parse..."}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center space-y-3">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600 mx-auto" />
              <p className="text-gray-500 text-sm">AI is editing your resume...</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
            <span className="text-red-600">✕</span>
            <span className="text-sm text-red-800 flex-1">{error}</span>
            <button
              onClick={handleEdit}
              className="text-red-600 underline text-sm"
            >
              Retry
            </button>
          </div>
        )}

        {/* Resume sections */}
        {sections && !loading && (
          <ResumeEditor
            sections={sections}
            originalSections={originalSections}
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
