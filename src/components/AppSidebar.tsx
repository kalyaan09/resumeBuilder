import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronsLeft, ChevronsRight, Cpu, FileText, History as HistoryNavIcon, UserRound } from "lucide-react";
import { useConnection } from "../context/ConnectionContext";
import { useProfiles } from "../context/ProfilesContext";
import { Button } from "../ui";
import { cn } from "../ui/cn";

const SIDEBAR_COLLAPSED_KEY = "resume-pro-sidebar-collapsed";

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

const TEMPLATE_LABELS: Record<string, string> = {
  jake: "Jake's Resume",
  faangpath: "FAANGPath",
  sb2nov: "RenderCV (sb2nov)",
  myresume: "My Resume",
};

const LEVEL_LABELS: Record<string, string> = {
  entry: "Entry",
  junior: "Junior",
  mid: "Mid",
};

function formatModelLine(mc: Record<string, string> | undefined): string {
  if (!mc?.provider) return "Not configured";
  const model = (mc.model || "").replace(/-/g, " ");
  const prov =
    mc.provider === "gemini"
      ? "Gemini"
      : mc.provider === "anthropic"
        ? "Claude"
        : mc.provider === "openai"
          ? "OpenAI"
          : mc.provider === "ollama"
            ? "Ollama"
            : mc.provider === "openrouter"
              ? "OpenRouter"
              : mc.provider === "groq"
                ? "Groq"
                : mc.provider;
  return model ? `${prov} · ${model}` : prov;
}

export default function AppSidebar({
  active,
  config,
}: {
  active: "editor" | "settings" | "history";
  config: Record<string, unknown> | null;
}) {
  const navigate = useNavigate();
  const { backendReady, backendConnecting, backendError } = useConnection();
  const { activeProfileName } = useProfiles();

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const templateName = TEMPLATE_LABELS[(config?.template as string) || ""] || "Your resume";
  const role = (config?.role as string) || "Not set";
  const levelKey = (config?.level as string) || "";
  const roleLine = `${role} · ${LEVEL_LABELS[levelKey] || levelKey || "Not set"}`;
  const profileLine = activeProfileName || roleLine;
  const modelLine = formatModelLine(config?.modelConfig as Record<string, string>);
  const modelParts = modelLine.split("·").map((s) => s.trim());
  const modelProvider = modelParts[0] || "Model";
  const modelName = modelParts.slice(1).join(" · ").trim();

  const connectionDot =
    backendReady && !backendConnecting ? (
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.25)]"
        title="Preview service connected"
      />
    ) : backendConnecting ? (
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400" title="Connecting…" />
    ) : (
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.25)]"
        title={backendError || "Preview service unavailable"}
      />
    );

  const navBtn = (isActive: boolean) =>
    cn(
      "h-auto w-full justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium",
      isActive
        ? "bg-black/[0.07] text-gray-900 shadow-sm dark:bg-white/[0.12] dark:text-white"
        : "text-gray-700 dark:text-gray-300"
    );

  const navBtnCollapsed = (isActive: boolean) =>
    cn(
      "mx-auto h-10 w-10 shrink-0 justify-center rounded-xl p-0",
      isActive
        ? "bg-black/[0.07] text-gray-900 shadow-sm dark:bg-white/[0.12] dark:text-white"
        : "text-gray-700 dark:text-gray-300"
    );

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-white/50 bg-[rgba(248,252,255,0.52)] shadow-[inset_-1px_0_0_rgba(255,255,255,0.45)] backdrop-blur-xl backdrop-saturate-110 transition-[width] duration-200 ease-out dark:border-white/10 dark:bg-white/[0.04] dark:backdrop-blur-none dark:backdrop-saturate-100 dark:shadow-none",
        collapsed ? "w-[56px]" : "w-[220px]"
      )}
    >
      {collapsed ? (
        <>
          <div className="flex flex-col items-center gap-2 px-2 pb-2 pt-4">
            <img src="/app_icon.png" alt="" className="h-9 w-9 shrink-0 rounded-lg" width={36} height={36} />
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-black/[0.06] hover:text-gray-800 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <ChevronsRight className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <nav className="flex flex-col items-center gap-1 px-1.5">
            <motion.div whileTap={{ scale: 0.99 }} className="w-full">
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate("/editor")}
                className={navBtnCollapsed(active === "editor")}
                aria-label="Editor"
                title="Editor"
              >
                <DocumentIcon className="h-5 w-5 shrink-0 opacity-90" />
              </Button>
            </motion.div>
            <motion.div whileTap={{ scale: 0.99 }} className="w-full">
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate("/history")}
                className={navBtnCollapsed(active === "history")}
                aria-label="History"
                title="History"
              >
                <HistoryNavIcon className="h-5 w-5 shrink-0 opacity-90" />
              </Button>
            </motion.div>
            <motion.div whileTap={{ scale: 0.99 }} className="w-full">
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate("/settings")}
                className={navBtnCollapsed(active === "settings")}
                aria-label="Settings"
                title="Settings"
              >
                <GearIcon className="h-5 w-5 shrink-0 opacity-90" />
              </Button>
            </motion.div>
          </nav>

          <div className="mt-auto flex flex-col items-center gap-3 border-t border-gray-200/70 px-2 py-4 text-xs text-gray-500 dark:border-white/10 dark:text-gray-400">
            {/* Match nav icon language: rounded icon button + label */}
            <div className="pointer-events-none flex flex-col items-center gap-3 text-[11px] text-gray-600 dark:text-gray-400">
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-700 dark:text-gray-200">
                  <FileText className="h-5 w-5 shrink-0 opacity-80" />
                </div>
                <span className="max-w-[52px] truncate">{templateName}</span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-700 dark:text-gray-200">
                  <UserRound className="h-5 w-5 shrink-0 opacity-80" />
                </div>
                <span className="max-w-[52px] truncate">{profileLine}</span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-700 dark:text-gray-200">
                  <Cpu className="h-5 w-5 shrink-0 opacity-80" />
                </div>
                <span className="max-w-[52px] truncate">{modelProvider}</span>
              </div>
            </div>
            <div className="flex justify-center" title={
              backendReady && !backendConnecting
                ? "Ready"
                : backendConnecting
                  ? "Connecting…"
                  : "Preview unavailable"
            }>
              {connectionDot}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3 py-4">
            <img src="/app_icon.png" alt="" className="h-9 w-9 shrink-0 rounded-lg" width={36} height={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">Resume Pro</div>
            </div>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="shrink-0 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-black/[0.06] hover:text-gray-800 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <ChevronsLeft className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <nav className="flex flex-col gap-0.5 px-2">
            <motion.div whileTap={{ scale: 0.99 }} className="w-full">
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate("/editor")}
                className={navBtn(active === "editor")}
              >
                <DocumentIcon className="h-5 w-5 shrink-0 opacity-70" />
                Editor
              </Button>
            </motion.div>
            <motion.div whileTap={{ scale: 0.99 }} className="w-full">
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate("/history")}
                className={navBtn(active === "history")}
              >
                <HistoryNavIcon className="h-5 w-5 shrink-0 opacity-70" />
                History
              </Button>
            </motion.div>
            <motion.div whileTap={{ scale: 0.99 }} className="w-full">
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate("/settings")}
                className={navBtn(active === "settings")}
              >
                <GearIcon className="h-5 w-5 shrink-0 opacity-70" />
                Settings
              </Button>
            </motion.div>
          </nav>

          <div className="mx-3 my-4 h-px bg-gray-200/70 dark:bg-white/10" />

          <div className="mt-auto space-y-3 px-4 pb-5 pt-2 text-xs text-gray-500 dark:text-gray-400">
            <div className="pointer-events-none select-none space-y-2.5 leading-snug">
              <div className="flex items-start gap-2">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
                <div className="min-w-0">
                  <span className="block truncate text-sm font-normal text-gray-800 dark:text-gray-200">{templateName}</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <UserRound className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
                <div className="min-w-0">
                  <span className="block truncate text-sm text-gray-700 dark:text-gray-300">{profileLine}</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Cpu className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
                <div className="min-w-0">
                  <span className="truncate text-sm text-gray-700 dark:text-gray-300">{modelProvider}</span>
                  {modelName ? (
                    <span className="mt-0.5 block line-clamp-2 text-[11px] text-gray-500/90 dark:text-gray-400">
                      {modelName}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-gray-200/60 pt-3 dark:border-white/10">
              {connectionDot}
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                {backendReady && !backendConnecting
                  ? "Ready"
                  : backendConnecting
                    ? "Connecting…"
                    : "Preview unavailable"}
              </span>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
