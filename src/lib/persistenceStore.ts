/**
 * File-backed persistence for the resume editor.
 *
 * New layout under ~/.resume-editor/:
 *   config.json             : template, role, level, sections, modelConfig, savePath, activeProfile
 *   shared.json             : basics + education (shared across all profiles)
 *   profiles/{id}/
 *     resume.json           : summary, experience, skills, projects, …
 *
 * readResume / writeResume transparently bridge old and new layouts:
 *   - New installs start on old layout (master_resume.json) and migrate to profiles on next server restart.
 *   - Once activeProfile is set in config, read/write go to shared.json + profiles/{id}/resume.json.
 *   - localStorage always holds a copy of the full merged resume as a fallback for browser dev mode.
 */

const DIR = ".resume-editor";
const CONFIG_PATH = `${DIR}/config.json`;

// Old single-file path, used as a fallback before migration runs.
const RESUME_PATH = `${DIR}/master_resume.json`;

const SHARED_PATH = `${DIR}/shared.json`;

const LS_CONFIG = "re_config";
const LS_RESUME = "re_resume";
const LS_SHARED = "re_shared";

const SHARED_KEYS: ReadonlySet<string> = new Set(["basics", "education"]);

function profileResumePath(id: string): string {
  return `${DIR}/profiles/${id}/resume.json`;
}

function profileLsKey(id: string): string {
  return `re_profile_${id}`;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  const { exists, mkdir, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  const ok = await exists(DIR, { baseDir: BaseDirectory.Home });
  if (!ok) {
    await mkdir(DIR, { baseDir: BaseDirectory.Home, recursive: true });
  }
}

async function ensureProfileDir(profileId: string): Promise<void> {
  const { exists, mkdir, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  const profilePath = `${DIR}/profiles/${profileId}`;
  const ok = await exists(profilePath, { baseDir: BaseDirectory.Home });
  if (!ok) {
    await mkdir(profilePath, { baseDir: BaseDirectory.Home, recursive: true });
  }
}

async function tauriRead(path: string): Promise<string | null> {
  try {
    const { readTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    return await readTextFile(path, { baseDir: BaseDirectory.Home });
  } catch {
    return null;
  }
}

async function tauriWrite(path: string, text: string): Promise<void> {
  const { writeTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  await ensureDir();
  await writeTextFile(path, text, { baseDir: BaseDirectory.Home });
}

async function tauriWriteProfile(profileId: string, text: string): Promise<void> {
  const { writeTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  await ensureProfileDir(profileId);
  await writeTextFile(profileResumePath(profileId), text, { baseDir: BaseDirectory.Home });
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function writeConfig(data: Record<string, unknown>): Promise<void> {
  const text = JSON.stringify(data, null, 2);
  localStorage.setItem(LS_CONFIG, text);
  try {
    await tauriWrite(CONFIG_PATH, text);
  } catch {
    // localStorage copy is the fallback (already written above).
  }
}

export async function readConfig(): Promise<Record<string, unknown> | null> {
  const diskText = await tauriRead(CONFIG_PATH);
  const lsText = localStorage.getItem(LS_CONFIG);
  let disk: Record<string, unknown> | null = null;
  let ls: Record<string, unknown> | null = null;
  try { if (diskText) disk = JSON.parse(diskText) as Record<string, unknown>; } catch { /* ignore */ }
  try { if (lsText) ls = JSON.parse(lsText) as Record<string, unknown>; } catch { /* ignore */ }
  if (!disk && !ls) return null;
  if (!disk) return ls;
  if (!ls) return disk;
  // localStorage wins: it's written first and holds the newest value when Tauri write fails.
  return { ...disk, ...ls };
}

// ── Shared data (basics + education) ─────────────────────────────────────────

export async function writeShared(data: Record<string, unknown>): Promise<void> {
  const text = JSON.stringify(data, null, 2);
  localStorage.setItem(LS_SHARED, text);
  try {
    await tauriWrite(SHARED_PATH, text);
  } catch {
    // localStorage fallback already written.
  }
}

export async function readShared(): Promise<Record<string, unknown> | null> {
  const text = (await tauriRead(SHARED_PATH)) ?? localStorage.getItem(LS_SHARED);
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── Per-profile resume data ───────────────────────────────────────────────────

export async function writeProfileResume(
  profileId: string,
  data: Record<string, unknown>
): Promise<void> {
  const text = JSON.stringify(data, null, 2);
  localStorage.setItem(profileLsKey(profileId), text);
  try {
    await tauriWriteProfile(profileId, text);
  } catch {
    // localStorage fallback already written.
  }
}

export async function readProfileResume(
  profileId: string
): Promise<Record<string, unknown> | null> {
  const text =
    (await tauriRead(profileResumePath(profileId))) ??
    localStorage.getItem(profileLsKey(profileId));
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── Full resume (merged view) ─────────────────────────────────────────────────

/**
 * Read the full resume for the currently active profile.
 *
 * Priority:
 * 1. New layout: shared.json + profiles/{activeProfile}/resume.json merged
 * 2. Old layout: master_resume.json (pre-migration) or localStorage fallback
 */
export async function readResume(): Promise<Record<string, unknown> | null> {
  const config = await readConfig();
  const activeId = (config?.activeProfile as string) || null;

  if (activeId) {
    const [shared, profile] = await Promise.all([
      readShared(),
      readProfileResume(activeId),
    ]);
    if (shared || profile) {
      // shared keys (basics, education) override whatever is in the profile file
      return { ...(profile || {}), ...(shared || {}) };
    }
  }

  // Fall back to old single-file structure (pre-migration or browser dev mode)
  const text = (await tauriRead(RESUME_PATH)) ?? localStorage.getItem(LS_RESUME);
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Write the full resume, splitting into shared.json (basics + education) and
 * profiles/{activeProfile}/resume.json (everything else).
 *
 * If no activeProfile is set in config (new user, pre-migration), writes to the
 * old master_resume.json path so the next server restart can migrate it.
 */
export async function writeResume(data: Record<string, unknown>): Promise<void> {
  // Always update localStorage with the full merged resume as a fallback.
  const mergedText = JSON.stringify(data, null, 2);
  localStorage.setItem(LS_RESUME, mergedText);

  const config = await readConfig();
  const activeId = (config?.activeProfile as string) || null;

  if (!activeId) {
    // No profile yet: write to old location; migration will split it on next server start.
    try {
      await tauriWrite(RESUME_PATH, mergedText);
    } catch {
      // localStorage fallback already written.
    }
    return;
  }

  // Split into shared part and profile-specific part.
  const sharedData: Record<string, unknown> = {};
  const profileData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (SHARED_KEYS.has(key)) {
      sharedData[key] = value;
    } else {
      profileData[key] = value;
    }
  }

  // Preserve the profile's id and name fields from the existing file.
  const existing = await readProfileResume(activeId);
  profileData.id = (existing?.id as string) || activeId;
  profileData.name = (existing?.name as string) || activeId;

  // Write both files; errors are swallowed (localStorage is the fallback).
  await Promise.all([
    writeShared(sharedData).catch(() => {}),
    writeProfileResume(activeId, profileData).catch(() => {}),
  ]);
}
