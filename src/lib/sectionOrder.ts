/**
 * Global default section order lives in config.json as `defaultSectionOrder`.
 * Legacy installs may only have `sectionOrder`; treat it as the default.
 * Per-profile overrides live in profile resume.json when `useCustomSectionOrder` is true.
 */

export const DEFAULT_SECTION_KEYS = [
  "summary",
  "experience",
  "education",
  "skills",
  "projects",
  "certifications",
  "publications",
  "awards",
  "volunteer",
  "languages",
] as const;

export const SECTION_LABELS: Record<string, string> = {
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  projects: "Projects",
  certifications: "Certifications",
  publications: "Publications",
  awards: "Awards",
  volunteer: "Volunteer",
  languages: "Languages",
};

export const CORE_SECTION_KEYS = ["summary", "experience", "skills", "education"] as const;

export function getDefaultSectionOrderFromConfig(config: Record<string, unknown> | null | undefined): string[] {
  if (!config) return [...DEFAULT_SECTION_KEYS];
  const def = config.defaultSectionOrder;
  if (Array.isArray(def) && def.length > 0) {
    return normalizeSectionOrder(def as string[]);
  }
  const leg = config.sectionOrder;
  if (Array.isArray(leg) && leg.length > 0) {
    return normalizeSectionOrder(leg as string[]);
  }
  return [...DEFAULT_SECTION_KEYS];
}

function normalizeSectionOrder(order: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of order) {
    if (typeof k !== "string" || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  for (const k of DEFAULT_SECTION_KEYS) {
    if (!seen.has(k)) out.push(k);
  }
  return out;
}

export function sectionHasData(data: unknown): boolean {
  if (!data) return false;
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data === "string") return data.trim().length > 0;
  if (typeof data === "object") return Object.keys(data as Record<string, unknown>).length > 0;
  return true;
}

export function computeSectionsWithData(profileResume: Record<string, unknown> | null | undefined): string[] {
  const resume = profileResume || {};
  const out = new Set<string>(CORE_SECTION_KEYS);
  for (const k of DEFAULT_SECTION_KEYS) {
    if (out.has(k)) continue;
    if (sectionHasData(resume[k])) out.add(k);
  }
  return Array.from(out);
}

export function mergeVisibleReorderWithHidden(input: {
  currentDefaultOrder: string[];
  visibleOrder: string[];
  visibleKeys: Set<string>;
}): string[] {
  const hiddenInCurrent = input.currentDefaultOrder.filter((k) => !input.visibleKeys.has(k));
  const seen = new Set<string>();
  const next: string[] = [];

  for (const k of input.visibleOrder) {
    if (typeof k !== "string" || seen.has(k)) continue;
    seen.add(k);
    next.push(k);
  }
  for (const k of hiddenInCurrent) {
    if (typeof k !== "string" || seen.has(k)) continue;
    seen.add(k);
    next.push(k);
  }

  // Ensure all known defaults remain present.
  for (const k of DEFAULT_SECTION_KEYS) {
    if (!seen.has(k)) next.push(k);
  }
  return next;
}

/**
 * @param mergedResume  Merged resume (e.g. from readResume) or profile JSON; may include `useCustomSectionOrder` + `sectionOrder`.
 */
export function getEffectiveSectionOrder(
  config: Record<string, unknown> | null | undefined,
  mergedResume: Record<string, unknown> | null | undefined
): string[] {
  const base = getDefaultSectionOrderFromConfig(config);
  if (!mergedResume) return base;
  const custom = mergedResume.useCustomSectionOrder === true;
  const po = mergedResume.sectionOrder;
  if (!custom || !Array.isArray(po) || po.length === 0) return base;
  return normalizeSectionOrder([...(po as string[])]);
}
