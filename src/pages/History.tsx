import { useCallback, useEffect, useMemo, useState } from "react";
import { History as HistoryIcon, RefreshCw } from "lucide-react";
import AppSidebar from "../components/AppSidebar";
import { readConfig } from "../lib/persistenceStore";
import { useConnection } from "../context/ConnectionContext";
import { useProfiles } from "../context/ProfilesContext";
import { getExportHistory, type ExportHistoryEntry } from "../lib/sidecarApi";
import { Button, Surface, TypographyH2, TypographyMuted } from "../ui";
import { cn } from "../ui/cn";

export default function History() {
  const { backendReady, backendConnecting } = useConnection();
  const { profiles } = useProfiles();
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [items, setItems] = useState<ExportHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const profileLabel = useMemo(() => {
    const m = new Map(profiles.map((p) => [p.id, p.name]));
    return (id: string) => m.get(id) || id || "—";
  }, [profiles]);

  const load = useCallback(async () => {
    if (!backendReady) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getExportHistory();
      const apps = Array.isArray(data.applications) ? data.applications : [];
      setItems([...apps].reverse());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [backendReady]);

  useEffect(() => {
    readConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="app-canvas flex h-screen overflow-hidden transition-colors duration-200">
      <AppSidebar active="history" config={config} />

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
        <Surface variant="panel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/25 px-5 py-4 dark:border-white/10">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <HistoryIcon className="h-5 w-5 shrink-0 text-gray-600 dark:text-gray-300" aria-hidden />
                <TypographyH2 className="border-0 pb-0 text-lg text-gray-900 dark:text-gray-100">Export history</TypographyH2>
              </div>
              <TypographyMuted className="mt-1 max-w-prose text-sm">
                One row per PDF export: company from the job description, detected role, keyword match score, and JD context
                captured at export time.
              </TypographyMuted>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={!backendReady || loading}
              onClick={() => void load()}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {!backendReady && !backendConnecting ? (
              <TypographyMuted className="text-sm">
                Connect to the preview service to load history from your machine.
              </TypographyMuted>
            ) : backendConnecting ? (
              <div className="flex items-center gap-3 py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
                <TypographyMuted>Connecting…</TypographyMuted>
              </div>
            ) : loading ? (
              <div className="flex items-center gap-3 py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
                <TypographyMuted>Loading history…</TypographyMuted>
              </div>
            ) : error ? (
              <div className="rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {error}
              </div>
            ) : items.length === 0 ? (
              <Surface variant="inset" className="rounded-xl p-8 text-center">
                <TypographyMuted className="text-sm leading-relaxed">
                  No exports yet. Open the Editor, tailor your resume, then export a PDF (Save). Each export appends a row to{" "}
                  <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">~/.resume-editor/history.json</code>.
                </TypographyMuted>
              </Surface>
            ) : (
              <ul className="space-y-3">
                {items.map((row, i) => (
                  <li key={`${row.date}-${row.company}-${row.profile_used}-${items.length - i}`}>
                    <Surface variant="inset" className="rounded-xl p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2 gap-y-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{row.company}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">{row.date}</span>
                          </div>
                          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{row.role}</p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                          <span className="rounded-full bg-black/[0.06] px-2.5 py-1 dark:bg-white/10">
                            {profileLabel(row.profile_used)}
                          </span>
                          <span className="tabular-nums">{row.font_size} pt</span>
                          <span>{row.pages} pg</span>
                        </div>
                      </div>
                      {(row.seniority || row.company_type) && (
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                          {[row.seniority, row.company_type].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {Array.isArray(row.jd_keywords) && row.jd_keywords.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {row.jd_keywords.slice(0, 12).map((kw) => (
                            <span
                              key={kw}
                              className="rounded-md border border-gray-200/80 bg-white/60 px-1.5 py-0.5 text-[11px] text-gray-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-200"
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="mt-2 text-left text-xs font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
                        onClick={() => setExpanded((prev) => ({ ...prev, [i]: !prev[i] }))}
                      >
                        {expanded[i] ? "Hide JD snippet" : "Show JD snippet"}
                      </button>
                      {expanded[i] && row.jd_snippet ? (
                        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-black/[0.04] p-3 text-xs leading-relaxed text-gray-700 dark:bg-white/[0.06] dark:text-gray-200">
                          {row.jd_snippet}
                        </p>
                      ) : null}
                    </Surface>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Surface>
      </div>
    </div>
  );
}
