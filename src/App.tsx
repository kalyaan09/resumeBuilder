import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Setup from "./pages/Setup";
import Editor from "./pages/Editor";
import Settings from "./pages/Settings";
import SettingsProfileEdit from "./pages/SettingsProfileEdit";
import History from "./pages/History";
import { readConfig, writeConfig } from "./lib/persistenceStore";
import { applyTheme, Theme } from "./lib/themeStore";
import { ConnectionContext } from "./context/ConnectionContext";
import { ProfilesContext } from "./context/ProfilesContext";
import type { Profile, TransformersContext } from "./lib/sidecarApi";
import { getProfiles, switchProfile } from "./lib/sidecarApi";

type TailoredGaps = {
  missing_skills?: string[];
  removed_unsupported_skills?: string[];
  added_supported_skills?: string[];
};

function App() {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [backendReady, setBackendReady] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [backendConnecting, setBackendConnecting] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  // Tailored resume state — lifted here so it survives Editor ↔ History ↔ Settings navigation.
  const [jdText, setJdText] = useState("");
  const [editedResume, setEditedResume] = useState<Record<string, unknown> | null>(null);
  const [tailoredGaps, setTailoredGaps] = useState<TailoredGaps | null>(null);
  const [transformersContext, setTransformersContext] = useState<TransformersContext>({});

  const refreshProfiles = useCallback(async () => {
    try {
      const data = await getProfiles();
      const nextProfiles = Array.isArray(data.profiles) ? data.profiles : [];
      const nextActive = typeof data.activeProfile === "string" ? data.activeProfile : null;
      setProfiles(nextProfiles);
      setActiveProfileId(nextActive);

      // Sync setupComplete with actual profile state from the backend.
      // This overrides any stale setupComplete:true left in localStorage/config after a data wipe.
      if (nextProfiles.length === 0) {
        setSetupComplete(false);
      }

      // If profiles exist, ensure setupComplete + a valid activeProfile are persisted.
      // nextActive can be null when config.json lacks activeProfile (old installs, partial resets) —
      // fall back to first profile so we don't incorrectly route to Setup.
      if (nextProfiles.length > 0) {
        const resolvedActive = nextActive || nextProfiles[0]?.id || null;
        if (resolvedActive && resolvedActive !== nextActive) {
          setActiveProfileId(resolvedActive);
        }
        setSetupComplete(true);
        void (async () => {
          const c = await readConfig().catch(() => null);
          const ids = new Set(nextProfiles.map((p) => p.id));
          const cur = typeof c?.activeProfile === "string" ? c.activeProfile : "";
          const needsFix = !c?.setupComplete || !cur || !ids.has(cur);
          if (needsFix) {
            await writeConfig({
              ...(c || {}),
              setupComplete: true,
              activeProfile: resolvedActive,
            }).catch(() => {});
          }
        })();
      }
    } catch {
      // If backend doesn't support profiles yet, silently fall back.
      setProfiles([]);
      setActiveProfileId(null);
    }
  }, []);

  const checkBackendHealth = useCallback(async (retries = 20, delayMs = 1500) => {
    setBackendConnecting(true);
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch("http://localhost:47372/health");
        if (res.ok) {
          setBackendReady(true);
          setBackendError(null);
          // MUST await: otherwise we set backendConnecting=false while profiles are still []
          // and the router sends the user to /setup before GET /profiles returns.
          await refreshProfiles();
          setBackendConnecting(false);
          return;
        }
      } catch {
        // not reachable
      }
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    setBackendConnecting(false);
    setBackendReady(false);
    setBackendError(
      "We could not reach the local service that prepares your PDF preview. Make sure the app helper is running."
    );
  }, [refreshProfiles]);

  useEffect(() => {
    readConfig()
      .then((config) => {
        // Existing installs often have activeProfile + data on disk but no setupComplete flag.
        const ap = config?.activeProfile;
        const hasActive = typeof ap === "string" && ap.length > 0;
        setSetupComplete(!!config?.setupComplete || hasActive);
        applyTheme((config?.theme as Theme) || "system");
      })
      .catch(() => {
        setSetupComplete(false);
        applyTheme("system");
      });

    void checkBackendHealth();
  }, [checkBackendHealth]);

  const connection = useMemo(
    () => ({
      backendReady,
      backendConnecting,
      backendError,
      retry: checkBackendHealth,
    }),
    [backendReady, backendConnecting, backendError, checkBackendHealth]
  );

  const profilesValue = useMemo(() => {
    const activeName = profiles.find((p) => p.id === activeProfileId)?.name ?? null;
    return {
      profiles,
      activeProfileId,
      activeProfileName: activeName,
      refresh: refreshProfiles,
      switchTo: async (profileId: string) => {
        await switchProfile(profileId);
        setActiveProfileId(profileId);
        await refreshProfiles();
      },
    };
  }, [profiles, activeProfileId, refreshProfiles]);

  // Stay on spinner while config is loading (null), OR while the backend is still
  // connecting (including the first GET /profiles after /health).
  // refreshProfiles() resets setupComplete to false if profiles are empty, so routing
  // on setupComplete is authoritative once backendConnecting is false.
  if (setupComplete === null || backendConnecting) {
    return (
      <div className="app-canvas flex min-h-screen flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
        <p className="text-sm text-gray-400 dark:text-gray-500">
          {backendConnecting ? "Starting up… first launch can take ~10 seconds" : "Loading…"}
        </p>
      </div>
    );
  }

  return (
    <ConnectionContext.Provider value={connection}>
      <ProfilesContext.Provider value={profilesValue}>
        <BrowserRouter>
          <Routes>
            <Route
              path="/"
              element={setupComplete ? <Navigate to="/editor" replace /> : <Navigate to="/setup" replace />}
            />
            <Route path="/setup" element={<Setup onComplete={() => setSetupComplete(true)} />} />
            <Route path="/editor" element={
              <Editor
                jdText={jdText}
                setJdText={setJdText}
                editedResume={editedResume}
                setEditedResume={setEditedResume}
                gaps={tailoredGaps}
                setGaps={setTailoredGaps}
                transformersContext={transformersContext}
                setTransformersContext={setTransformersContext}
              />
            } />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/profile/:profileId/edit" element={<SettingsProfileEdit />} />
          </Routes>
        </BrowserRouter>
      </ProfilesContext.Provider>
    </ConnectionContext.Provider>
  );
}

export default App;
