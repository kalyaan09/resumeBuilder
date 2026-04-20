import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Eraser, Save, Sparkles } from "lucide-react";
import ResumeEditor from "../components/ResumeEditor";
import AppSidebar from "../components/AppSidebar";
import { getApiKey } from "../lib/secureStore";
import { readConfig, readResume, writeConfig } from "../lib/persistenceStore";
import { Button, Modal, SegmentedControl, Surface } from "../ui";

const SIDECAR = "http://localhost:8000";
const FONT_SIZES = [9, 9.5, 10, 10.5, 11];

const SAMPLE_RESUME = {
  basics: {
    name: "Alex Johnson",
    email: "alex.johnson@email.com",
    phone: "(555) 867-5309",
    location: "San Francisco, CA",
    linkedin: "linkedin.com/in/alexjohnson",
    github: "github.com/alexjohnson",
    portfolio: "alexjohnson.dev",
  },
  summary:
    "Software Engineer with 4 years of experience building scalable distributed systems " +
    "and data pipelines. Passionate about developer tooling, ML infrastructure, and " +
    "open-source contributions. Led cross-functional teams shipping features used by millions.",
  experience: [
    {
      company: "Stripe",
      title: "Software Engineer II",
      location: "San Francisco, CA",
      startDate: "June 2022",
      endDate: "Present",
      bullets: [
        "Designed and shipped a real-time fraud detection pipeline processing 50K transactions/sec, reducing chargebacks by 23% ($4M/year saved).",
        "Led migration of legacy monolith services to Kubernetes microservices, cutting p99 latency from 800ms to 120ms.",
        "Mentored 3 junior engineers and conducted 60+ technical interviews, improving team hiring bar.",
      ],
    },
    {
      company: "Amazon Web Services",
      title: "Software Development Engineer",
      location: "Seattle, WA",
      startDate: "July 2020",
      endDate: "May 2022",
      bullets: [
        "Built an internal A/B testing framework adopted by 15 teams, enabling 200+ concurrent experiments.",
        "Optimized DynamoDB query patterns reducing read costs by 40% across 3 high-traffic services.",
        "Implemented CI/CD pipelines using CodePipeline and CloudFormation, cutting deploy time from 45 min to 8 min.",
      ],
    },
  ],
  education: [
    {
      institution: "University of California, Berkeley",
      degree: "Bachelor of Science",
      field: "Electrical Engineering & Computer Science",
      endDate: "May 2020",
      gpa: "3.8",
    },
  ],
  skills: [
    { category: "Languages", items: ["Python", "Go", "Java", "TypeScript", "SQL"] },
    { category: "Frameworks", items: ["FastAPI", "React", "gRPC", "Kafka", "Spark"] },
    { category: "Cloud & DevOps", items: ["AWS", "GCP", "Kubernetes", "Terraform", "Docker"] },
    { category: "Databases", items: ["PostgreSQL", "DynamoDB", "Redis", "BigQuery"] },
  ],
  projects: [
    {
      name: "OpenTelemetry Contrib — Kafka Receiver",
      startDate: "Jan 2023",
      endDate: "Present",
      bullets: [
        "Authored Kafka metrics receiver merged into the official OTel Collector contrib repo (500+ GitHub stars).",
        "Reduced instrumentation boilerplate for Kafka consumers from 200 lines to a single config block.",
      ],
    },
    {
      name: "ResumeCraft — AI Resume Tailoring Tool",
      startDate: "Aug 2023",
      endDate: "Dec 2023",
      bullets: [
        "Built a local-first Tauri + FastAPI desktop app that uses LLMs to tailor resumes to job descriptions.",
        "Integrated Playwright PDF export with 4 professional templates; used by 1,200+ job seekers.",
      ],
    },
  ],
  certifications: [
    { name: "AWS Certified Solutions Architect – Professional", issuer: "Amazon", date: "2022" },
    { name: "Google Cloud Professional Data Engineer", issuer: "Google", date: "2023" },
  ],
  publications: [],
  awards: [],
  volunteer: [],
  languages: [],
};

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

  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [masterResume, setMasterResume] = useState<Record<string, unknown> | null>(null);
  const [masterSections, setMasterSections] = useState<Record<string, unknown> | null>(null);
  const [editedSections, setEditedSections] = useState<Record<string, unknown> | null>(null);
  const [editedResume, setEditedResume] = useState<Record<string, unknown> | null>(null);

  const [jdText, setJdText] = useState("");
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
    Promise.all([readConfig(), readResume()])
      .then(([cfg, resume]) => {
        setConfig(cfg);
        const dfSize = (cfg?.defaultFontSize as number) || 10;
        setDefaultFontSize(dfSize);
        setFontSize(dfSize);
        setMasterResume(resume);

        if (cfg && resume) {
          const order = (cfg.sectionOrder as string[]) || Object.keys(resume);
          const active = (cfg.activeSections as string[]) || order;
          setMasterSections(filterSections(resume, order, active));
        }
      })
      .finally(() => setDataLoading(false));
  }, []);

  useEffect(() => {
    if (!editedResume || !config) return;
    const order = (config.sectionOrder as string[]) || Object.keys(editedResume);
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
            section_order: (config.sectionOrder as string[]) || [],
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

  async function fullLlmConfig() {
    const base = (config?.modelConfig as Record<string, string>) || {};
    const api_key = await getApiKey(base.provider || "").catch(() => "");
    return { ...base, api_key };
  }

  async function handleEdit() {
    if (!jdText.trim() || !masterResume) return;
    setLoading(true);
    setError(null);

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
          section_order: (config.sectionOrder as string[]) || [],
          active_sections: (config.activeSections as string[]) || [],
          save_path: (config?.savePath as string) || "~/Documents/Resumes",
          font_size: sizeToUse,
          auto_fit: !fontSizeManual,
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

  function handleLoadSample() {
    setEditedResume(SAMPLE_RESUME);
    setError(null);
    setPreviewSrc(null);
  }

  if (dataLoading) {
    return (
      <div className="app-canvas flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (!config?.setupComplete || !masterResume) {
    return (
      <div className="app-canvas flex min-h-screen flex-col">
        <div className="flex flex-1 items-center justify-center p-6">
          <Surface variant="solid" className="w-full max-w-md space-y-4 p-10 text-center">
            <div className="text-4xl opacity-80">📄</div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">No master resume found</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Finish setup to import your resume and start tailoring it to each role.
            </p>
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
                <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-gray-100">Job description</h2>
                <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  Paste the posting. We will match your resume to what they are looking for.
                </p>
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
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleEdit}
                  disabled={!jdText.trim() || loading}
                  className="mx-auto mt-4 shrink-0 rounded-btn px-4 py-2 text-sm font-semibold"
                >
                  <Sparkles data-icon="inline-start" />
                  {loading ? "Tailoring…" : "Tailor"}
                </Button>
              </div>

              {/* Divider: darker in light so it’s visible on pale canvas */}
              <div className="h-px bg-black/10 dark:bg-white/10" />

              {loading && (
                <div className="flex flex-col items-center justify-center py-14">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
                  <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Shaping your experience to fit this role…</p>
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
                  <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-gray-100">Edited resume</h2>
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

          {(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && (
            <div className="border-t border-white/20 px-6 py-2 dark:border-white/10">
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={handleLoadSample}
                className="h-auto p-0 text-xs text-amber-700 decoration-dashed dark:text-amber-400"
                title="Development only"
              >
                Load sample resume
              </Button>
            </div>
          )}
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
                    <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Updating preview…</p>
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
            {overflowWarning && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                {overflowWarning}
              </p>
            )}
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Font size
              </span>
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

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleExportClick}
              disabled={!editedResume || exportLoading}
              className="mx-auto shrink-0 rounded-btn px-4 py-2 text-sm font-semibold"
            >
              <Save data-icon="inline-start" />
              {exportLoading ? "Saving…" : "Save"}
            </Button>

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
        title="Font size changed"
        className="w-[min(420px,94vw)]"
        dense
      >
        <div className="flex flex-col gap-4 px-5 pb-5 pt-2">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            You changed font size from <span className="font-semibold">{defaultFontSize}pt</span> to{" "}
            <span className="font-semibold">{fontSize}pt</span>. Save this as your new default, or use it only for this export?
          </p>
          <div className="flex gap-3">
            <Button type="button" onClick={handleSaveAsDefault} className="flex-1">
              Save as default
            </Button>
            <Button type="button" variant="secondary" onClick={handleJustThisOnce} className="flex-1">
              Just this once
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" className="w-full text-xs text-gray-500" onClick={() => setFontSizeDialog(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  );
}
