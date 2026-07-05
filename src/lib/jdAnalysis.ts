import type { Profile, TransformersContext } from "./sidecarApi";

const STOPWORDS = new Set(
  [
    "the","and","for","with","you","your","are","will","from","that","this","have","has","had","not","but","our","we","they",
    "a","an","to","of","in","on","at","by","as","is","it","or","be","can","may","into","across","within","over","per","plus",
    "role","job","team","work","working","including","experience","years","year","skills","responsibilities","requirements",
  ].map((s) => s.toLowerCase())
);

function tokenize(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .split(/[^a-z0-9#+.]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function extractKeywords(jdText: string, topN = 10): string[] {
  const tokens = tokenize(jdText).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w]) => w);
}

export function detectSeniority(jdText: string): TransformersContext["seniority"] {
  const t = jdText.toLowerCase();
  if (/\bprincipal\b/.test(t)) return "principal";
  if (/\bstaff\b/.test(t)) return "staff";
  if (/\blead\b/.test(t)) return "lead";
  if (/\bsenior\b|\bsr\b/.test(t)) return "senior";
  if (/\bjunior\b|\bjr\b/.test(t)) return "junior";
  if (/\bentry\b|\bnew grad\b|\bgraduate\b/.test(t)) return "entry";
  if (/\bmid\b|\bmid-level\b/.test(t)) return "mid";
  return "unknown";
}

export function detectCompanyType(jdText: string): TransformersContext["company_type"] {
  const t = jdText.toLowerCase();
  if (/\bseries\s+[a-f]\b|\bseed\b|\bstartup\b/.test(t)) return "startup";
  if (/\bfortune\s*500\b/.test(t)) return "fortune_500";
  if (/\benterprise\b|\bglobal\b|\bmultinational\b/.test(t)) return "enterprise";
  return "unknown";
}

export function weakBulletIndicesFromResume(
  jdText: string,
  resume: Record<string, unknown> | null,
  count = 6
): number[] {
  const jdKw = new Set(extractKeywords(jdText, 30));
  const exp = Array.isArray((resume as any)?.experience) ? ((resume as any).experience as any[]) : [];
  const bullets: string[] = [];
  for (const e of exp) {
    const bs = Array.isArray(e?.bullets) ? e.bullets : [];
    for (const b of bs) bullets.push(String(b || ""));
  }
  const scored = bullets.map((b, idx) => {
    const tokens = tokenize(b).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
    if (tokens.length === 0) return { idx, score: 0 };
    let hit = 0;
    for (const tok of tokens) if (jdKw.has(tok)) hit++;
    return { idx, score: hit / Math.max(6, tokens.length) };
  });
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, Math.min(count, scored.length))
    .map((s) => s.idx);
}

/** Smaller than mobilebert; filter Network by `distilbert` or `onnx` when debugging downloads. */
const CLASSIFIER_MODEL = "Xenova/distilbert-base-uncased-mnli";
const CLASSIFIER_LOAD_TIMEOUT_MS = 30_000;

let classifierPromise: Promise<any | null> | null = null;
let classifierFailCount = 0;

async function getClassifier(): Promise<any | null> {
  // After 3 consecutive failures, stop retrying for the session
  if (classifierFailCount >= 3) return null;
  if (!classifierPromise) {
    const loadPipeline = async () => {
      try {
        const { pipeline } = await import("@xenova/transformers");
        return await pipeline("zero-shot-classification", CLASSIFIER_MODEL);
      } catch (e) {
        console.error("[jdAnalysis] Classifier pipeline error:", e);
        throw e;
      }
    };

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("CLASSIFIER_TIMEOUT")), CLASSIFIER_LOAD_TIMEOUT_MS);
    });

    classifierPromise = Promise.race([loadPipeline(), timeout])
      .then((model) => model)
      .catch((err: unknown) => {
        classifierFailCount += 1;
        classifierPromise = null;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "CLASSIFIER_TIMEOUT") {
          console.error("[jdAnalysis] Classifier load failed:", err);
        }
        return null;
      });
  }
  return classifierPromise;
}

/** When the model is unavailable, pick a profile from JD keyword / phrase overlap only. */
function keywordFallbackProfileMatch(jdText: string, profiles: Profile[]): ProfileMatchResult {
  const empty: ProfileMatchResult = {
    bestProfile: null,
    classifierTopLabel: null,
    detectedRole: null,
    scores: {},
    rawOutput: { fallback: "keyword" },
    bestCombinedScore: 0,
  };
  if (!jdText.trim() || profiles.length === 0) return empty;
  const jdLower = jdText.toLowerCase();
  let bestProfile: Profile | null = null;
  let bestFuzzy = -1;
  for (const p of profiles) {
    const name = p.name?.trim();
    if (!name) continue;
    const fz = fuzzyProfileJdBoost(jdLower, name);
    if (fz > bestFuzzy) {
      bestFuzzy = fz;
      bestProfile = p;
    }
  }
  const fuzzyTop = bestProfile ? fuzzyProfileJdBoost(jdLower, bestProfile.name) : 0;
  const confidentEnough = fuzzyTop >= 2.4 || (profiles.length === 1 && !!bestProfile);
  const topName = bestProfile?.name ?? null;
  const scores: Record<string, number> = {};
  if (topName) scores[topName] = Math.min(1, bestFuzzy / 8);

  if (!confidentEnough) {
    return {
      ...empty,
      detectedRole: topName,
      scores,
      bestCombinedScore: bestFuzzy,
    };
  }

  return {
    bestProfile,
    classifierTopLabel: null,
    detectedRole: topName,
    scores,
    rawOutput: { fallback: "keyword", bestFuzzy },
    bestCombinedScore: bestFuzzy,
  };
}

/** Phrases in JD text that imply a short profile name (case-insensitive substring match). */
const PROFILE_NAME_PHRASES: Record<string, readonly string[]> = {
  de: ["data engineer", "data engineering", "data pipeline", "etl pipeline", "data warehouse", "dwh", "analytics engineer"],
  "data engineer": ["data engineer", "data engineering", "data pipelines"],
  sde: ["software development engineer", "software engineer", "swe ", " sw engineer"],
  swe: ["software engineer", "software developer", "backend engineer", "frontend engineer", "full stack", "fullstack"],
  ds: ["data scientist", "research scientist", "applied scientist"],
  da: ["data analyst", "business analyst", "analytics"],
  ml: ["machine learning", "ml engineer", "mlops", "deep learning"],
  "ml engineer": ["machine learning", "ml engineer", "mlops", "deep learning"],
  "ai engineer": ["ai engineer", "artificial intelligence", "machine learning", "genai", "llm"],
  "ai/ml": ["ai engineer", "machine learning", "ml engineer", "artificial intelligence", "deep learning", "mlops"],
  pm: ["product manager", "product management", "product owner"],
  tpm: ["technical program", "tpm", "program manager"],
  ba: ["business analyst"],
  devops: ["devops", "sre", "site reliability", "platform engineer", "infrastructure"],
  qa: ["qa engineer", "quality assurance", "test engineer", "sdet"],
};

function phrasesForProfileName(profileName: string): string[] {
  const n = profileName.trim().toLowerCase();
  if (!n) return [];
  const out = new Set<string>([n]);
  for (const part of n.split(/[/|,]+/)) {
    const p = part.trim().toLowerCase();
    if (p) {
      out.add(p);
      const extra = PROFILE_NAME_PHRASES[p];
      if (extra) for (const e of extra) out.add(e);
    }
  }
  const full = PROFILE_NAME_PHRASES[n.replace(/\s+/g, " ")];
  if (full) for (const e of full) out.add(e);
  return [...out].filter((s) => s.length >= 2);
}

/** Partial / fuzzy strength between JD and a profile display name (not normalized to 0–1). */
function fuzzyProfileJdBoost(jdLower: string, profileName: string): number {
  let max = 0;
  const n = profileName.trim().toLowerCase();
  for (const phrase of phrasesForProfileName(profileName)) {
    if (phrase.length < 2) continue;
    if (jdLower.includes(phrase)) {
      max = Math.max(max, 4 + Math.min(phrase.length, 24) * 0.08);
    }
  }
  if (n.length >= 2 && jdLower.includes(n)) {
    max = Math.max(max, 3 + Math.min(n.length, 20) * 0.06);
  }
  const nameTokens = n.split(/[/\s,]+/).filter((t) => t.length >= 2);
  for (const tok of nameTokens) {
    if (jdLower.includes(tok)) max = Math.max(max, 1.2);
  }
  return max;
}

export type ProfileMatchResult = {
  /** Profile to switch to, if any */
  bestProfile: Profile | null;
  /** Top zero-shot label (always one of profile names when the model returns normally) */
  classifierTopLabel: string | null;
  /** Same as classifierTopLabel: what the classifier ranked first */
  detectedRole: string | null;
  scores: Record<string, number>;
  rawOutput: unknown;
  /** Combined score used to pick bestProfile (for debugging) */
  bestCombinedScore: number;
};

export async function detectBestProfile(jdText: string, profiles: Profile[]): Promise<ProfileMatchResult> {
  const empty: ProfileMatchResult = {
    bestProfile: null,
    classifierTopLabel: null,
    detectedRole: null,
    scores: {},
    rawOutput: null,
    bestCombinedScore: 0,
  };
  if (!jdText.trim() || profiles.length === 0) return empty;
  const labels = profiles.map((p) => p.name).filter(Boolean);
  if (labels.length === 0) return empty;

  const jdLower = jdText.toLowerCase();
  const zsWeight = 1.35;
  const fuzzyWeight = 0.32;

  const clf = await getClassifier();
  if (!clf) {
    return keywordFallbackProfileMatch(jdText, profiles);
  }

  let out: unknown;
  try {
    out = await clf(jdText, labels);
  } catch (e) {
    console.error("[jdAnalysis] Classification inference failed, using keyword fallback:", e);
    return keywordFallbackProfileMatch(jdText, profiles);
  }

  const outLabels: string[] = Array.isArray((out as any)?.labels) ? (out as any).labels : [];
  const outScores: number[] = Array.isArray((out as any)?.scores) ? (out as any).scores : [];
  const scores: Record<string, number> = {};
  for (let i = 0; i < outLabels.length; i++) scores[outLabels[i]] = Number(outScores[i] ?? 0);

  const classifierTopLabel = outLabels[0] || null;

  let bestProfile: Profile | null = null;
  let bestCombined = -1;

  for (const p of profiles) {
    const name = p.name?.trim();
    if (!name) continue;
    const zs = scores[name] ?? 0;
    const fz = fuzzyProfileJdBoost(jdLower, name);
    const combined = zs * zsWeight + fz * fuzzyWeight;
    if (combined > bestCombined) {
      bestCombined = combined;
      bestProfile = p;
    }
  }

  const zsTop = classifierTopLabel ? scores[classifierTopLabel] ?? 0 : 0;
  const fuzzyTop = bestProfile ? fuzzyProfileJdBoost(jdLower, bestProfile.name) : 0;
  const confidentEnough =
    bestCombined >= 0.18 || zsTop >= 0.22 || fuzzyTop >= 2.4 || (profiles.length === 1 && !!bestProfile);

  if (!confidentEnough) {
    return {
      bestProfile: null,
      classifierTopLabel,
      detectedRole: classifierTopLabel,
      scores,
      rawOutput: out,
      bestCombinedScore: bestCombined,
    };
  }

  return {
    bestProfile,
    classifierTopLabel,
    detectedRole: classifierTopLabel,
    scores,
    rawOutput: out,
    bestCombinedScore: bestCombined,
  };
}

