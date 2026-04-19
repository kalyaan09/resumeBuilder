import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Setup from "./pages/Setup";
import Editor from "./pages/Editor";
import Settings from "./pages/Settings";
import { readConfig } from "./lib/persistenceStore";
import { applyTheme, Theme } from "./lib/themeStore";
import { ConnectionContext } from "./context/ConnectionContext";

function App() {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [backendReady, setBackendReady] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [backendConnecting, setBackendConnecting] = useState(true);

  useEffect(() => {
    readConfig()
      .then((config) => {
        setSetupComplete(!!config?.setupComplete);
        applyTheme((config?.theme as Theme) || "system");
      })
      .catch(() => {
        setSetupComplete(false);
        applyTheme("system");
      });

    checkBackendHealth();
  }, []);

  const checkBackendHealth = useCallback(async (retries = 40, delayMs = 1500) => {
    setBackendConnecting(true);
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch("http://localhost:8000/health");
        if (res.ok) {
          setBackendReady(true);
          setBackendError(null);
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
  }, []);

  const connection = useMemo(
    () => ({
      backendReady,
      backendConnecting,
      backendError,
      retry: checkBackendHealth,
    }),
    [backendReady, backendConnecting, backendError, checkBackendHealth]
  );

  if (setupComplete === null) {
    return (
      <div className="app-canvas flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <ConnectionContext.Provider value={connection}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              setupComplete ? <Navigate to="/editor" replace /> : <Navigate to="/setup" replace />
            }
          />
          <Route path="/setup" element={<Setup onComplete={() => setSetupComplete(true)} />} />
          <Route path="/editor" element={<Editor />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </BrowserRouter>
    </ConnectionContext.Provider>
  );
}

export default App;
