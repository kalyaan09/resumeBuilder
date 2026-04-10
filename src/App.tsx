import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Setup from "./pages/Setup";
import Editor from "./pages/Editor";
import Settings from "./pages/Settings";

const CONFIG_KEY = "resume_editor_config";

function App() {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [sidecarReady, setSidecarReady] = useState(false);
  const [sidecarError, setSidecarError] = useState<string | null>(null);
  const [sidecarConnecting, setSidecarConnecting] = useState(true);

  useEffect(() => {
    // Check if setup has been completed
    const config = localStorage.getItem(CONFIG_KEY);
    if (config) {
      try {
        const parsed = JSON.parse(config);
        setSetupComplete(!!parsed.setupComplete);
      } catch {
        setSetupComplete(false);
      }
    } else {
      setSetupComplete(false);
    }

    // Check Python sidecar health
    checkSidecar();
  }, []);

  async function checkSidecar(retries = 8, delayMs = 1500) {
    setSidecarConnecting(true);
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch("http://localhost:8000/health");
        if (res.ok) {
          setSidecarReady(true);
          setSidecarError(null);
          setSidecarConnecting(false);
          return;
        }
      } catch {
        // Not reachable yet
      }
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    setSidecarConnecting(false);
    setSidecarError(
      "Python sidecar is not running. Start it with: cd python && python main.py"
    );
  }

  if (setupComplete === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      {sidecarError && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700 flex items-center gap-2">
          <span className="font-medium">⚠ Sidecar offline:</span> {sidecarError}
          <button
            className="ml-auto text-red-600 underline"
            onClick={checkSidecar}
          >
            Retry
          </button>
        </div>
      )}
      {!sidecarError && sidecarConnecting && (
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-1 text-xs text-gray-500 text-center">
          Connecting to AI sidecar…
        </div>
      )}
      {!sidecarError && sidecarReady && !sidecarConnecting && (
        <div className="bg-green-50 border-b border-green-200 px-4 py-1 text-xs text-green-700 text-center">
          ✓ AI sidecar connected
        </div>
      )}
      <Routes>
        <Route
          path="/"
          element={
            setupComplete ? (
              <Navigate to="/editor" replace />
            ) : (
              <Navigate to="/setup" replace />
            )
          }
        />
        <Route
          path="/setup"
          element={<Setup onComplete={() => setSetupComplete(true)} />}
        />
        <Route path="/editor" element={<Editor />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
