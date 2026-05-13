import { parseErrorDetailBody } from "./httpError";

const SIDECAR = "http://localhost:8000";

export type Profile = {
  id: string;
  name: string;
};

export type ProfilesResponse = {
  profiles: Profile[];
  activeProfile: string | null;
};

export type ExportHistoryEntry = {
  date: string;
  company: string;
  role: string;
  profile_used: string;
  match_score: number;
  jd_snippet: string;
  jd_keywords: string[];
  seniority: string;
  company_type: string;
  font_size: number;
  pages: number;
};

export type ExportHistoryResponse = {
  applications: ExportHistoryEntry[];
};

export type TransformersContext = {
  detected_role?: string;
  must_include_keywords?: string[];
  seniority?: "entry" | "junior" | "mid" | "senior" | "lead" | "staff" | "principal" | "unknown";
  company_type?: "startup" | "enterprise" | "fortune_500" | "unknown";
  weak_bullet_indices?: number[];
  keywords?: string[];
};

async function jsonOrThrow(res: Response) {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(parseErrorDetailBody(text, res));
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export async function getProfiles(): Promise<ProfilesResponse> {
  const res = await fetch(`${SIDECAR}/profiles`);
  return (await jsonOrThrow(res)) as ProfilesResponse;
}

export async function getExportHistory(): Promise<ExportHistoryResponse> {
  const res = await fetch(`${SIDECAR}/history`);
  return (await jsonOrThrow(res)) as ExportHistoryResponse;
}

export async function createProfile(input: {
  name: string;
  resumeFile: File;
  llm_config: Record<string, string>;
}): Promise<Profile> {
  const arrayBuffer = await input.resumeFile.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  const extension = "." + input.resumeFile.name.split(".").pop()!.toLowerCase();
  const res = await fetch(`${SIDECAR}/create-profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name, file: base64, extension, llm_config: input.llm_config }),
  });
  return (await jsonOrThrow(res)).profile as Profile;
}

export async function resetAll(): Promise<void> {
  const res = await fetch(`${SIDECAR}/reset`, { method: "POST" });
  await jsonOrThrow(res);
}

export async function switchProfile(profileId: string): Promise<void> {
  const res = await fetch(`${SIDECAR}/switch-profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId }),
  });
  await jsonOrThrow(res);
}

export async function deleteProfile(profileId: string): Promise<void> {
  const res = await fetch(`${SIDECAR}/profile/${encodeURIComponent(profileId)}`, { method: "DELETE" });
  await jsonOrThrow(res);
}

export async function getShared(): Promise<Record<string, unknown>> {
  const res = await fetch(`${SIDECAR}/shared`);
  return (await jsonOrThrow(res)) as Record<string, unknown>;
}

export async function putShared(shared: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SIDECAR}/shared`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shared }),
  });
  await jsonOrThrow(res);
}

export async function getProfileResume(profileId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${SIDECAR}/profile/${encodeURIComponent(profileId)}`);
  return (await jsonOrThrow(res)) as Record<string, unknown>;
}

export async function putProfileResume(profileId: string, resume: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SIDECAR}/profile/${encodeURIComponent(profileId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resume }),
  });
  await jsonOrThrow(res);
}

const PROFILE_SYNC_SKIP_KEYS = new Set([
  "id",
  "name",
  "useCustomSectionOrder",
  "sectionOrder",
]);

function stripProfileMetaForSync(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (PROFILE_SYNC_SKIP_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export type SyncSuggestion = {
  section: string;
  type: "error" | "warning" | "info";
  message: string;
};

export async function syncProfile(input: {
  profile_id: string;
  resume_before: Record<string, unknown>;
  resume_after: Record<string, unknown>;
  role: string;
  level: string;
  llm_config: Record<string, string>;
}): Promise<{ suggestions: SyncSuggestion[] }> {
  const res = await fetch(`${SIDECAR}/sync-profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile_id: input.profile_id,
      resume_before: stripProfileMetaForSync(input.resume_before),
      resume_after: stripProfileMetaForSync(input.resume_after),
      role: input.role,
      level: input.level,
      llm_config: input.llm_config,
    }),
  });
  return (await jsonOrThrow(res)) as { suggestions: SyncSuggestion[] };
}

