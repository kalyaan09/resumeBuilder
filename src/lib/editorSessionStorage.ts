import type { TransformersContext } from "./sidecarApi";

const STORAGE_KEY = "resumePro.editorDraft.v1";

export type EditorSessionGaps = {
  missing_skills?: string[];
  removed_unsupported_skills?: string[];
  added_supported_skills?: string[];
};

export type EditorSessionV1 = {
  v: 1;
  profileId: string | null;
  jdText: string;
  editedResume: Record<string, unknown> | null;
  transformersContext: TransformersContext;
  gaps: EditorSessionGaps | null;
  fontSize: number;
  fontSizeManual: boolean;
  lastExportPath: string | null;
};

export function emptyEditorSession(profileId: string | null): EditorSessionV1 {
  return {
    v: 1,
    profileId,
    jdText: "",
    editedResume: null,
    transformersContext: {},
    gaps: null,
    fontSize: 10,
    fontSizeManual: false,
    lastExportPath: null,
  };
}

export function readEditorSession(): EditorSessionV1 | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EditorSessionV1;
    if (!parsed || parsed.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeEditorSession(session: EditorSessionV1): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* quota / private mode */
  }
}

export function clearEditorSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function buildEditorSession(partial: {
  profileId: string | null;
  jdText: string;
  editedResume: Record<string, unknown> | null;
  transformersContext: TransformersContext;
  gaps: EditorSessionGaps | null;
  fontSize: number;
  fontSizeManual: boolean;
  lastExportPath: string | null;
}): EditorSessionV1 {
  return {
    v: 1,
    profileId: partial.profileId,
    jdText: partial.jdText,
    editedResume: partial.editedResume,
    transformersContext: partial.transformersContext ?? {},
    gaps: partial.gaps,
    fontSize: partial.fontSize,
    fontSizeManual: partial.fontSizeManual,
    lastExportPath: partial.lastExportPath,
  };
}
