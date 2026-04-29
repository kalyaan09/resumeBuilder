import { useState, useLayoutEffect, useRef } from "react";

// ── Shared primitives ────────────────────────────────────────────────────────

const inputBase =
  "bg-transparent border-b border-transparent hover:border-gray-200 dark:hover:border-gray-600 focus:border-brand-500 focus:outline-none transition-colors";

function InlineInput({
  value,
  onChange,
  placeholder = "…",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const width = Math.max((value || "").length, (placeholder || "").length, 3) + 1;
  return (
    <input
      type="text"
      value={value || ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: `${width}ch` }}
      className={`${inputBase} max-w-full ${className}`}
    />
  );
}

function InlineTextarea({
  value,
  onChange,
  placeholder = "…",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const desiredSelection = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset first so shrinking works, then expand to full content height
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    // Preserve caret/selection (some WebViews reset selection on controlled updates + style changes)
    const sel = desiredSelection.current;
    if (document.activeElement === el && sel) {
      try {
        el.setSelectionRange(sel.start, sel.end);
      } catch {
        /* ignore */
      }
      desiredSelection.current = null;
    }
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value || ""}
      placeholder={placeholder}
      onChange={(e) => {
        // Capture caret from the input event (more reliable than reading after render in WebViews).
        try {
          desiredSelection.current = { start: e.target.selectionStart ?? 0, end: e.target.selectionEnd ?? 0 };
        } catch {
          desiredSelection.current = null;
        }
        onChange(e.target.value);
      }}
      rows={2}
      className={`w-full bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-gray-600 focus:border-brand-500 focus:outline-none rounded px-1 py-0.5 resize-none overflow-hidden transition-colors leading-snug ${className}`}
    />
  );
}

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 transition-colors py-0.5"
    >
      + {label}
    </button>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Remove"
      className="text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors text-xs leading-none flex-shrink-0 opacity-0 group-hover:opacity-100"
    >
      ✕
    </button>
  );
}

// ── Bullets (shared by experience + projects) ────────────────────────────────

function BulletList({
  bullets,
  onChange,
  notes,
}: {
  bullets: string[];
  onChange: (b: string[]) => void;
  notes?: Array<{ type: "error" | "warning" | "info"; message: string; target?: any }>;
}) {
  const notesForBullet = (idx: number) =>
    (notes || []).filter((n) => n?.target?.kind === "bullet" && n?.target?.bulletIndex === idx);
  return (
    <div className="space-y-1 mt-1.5">
      {bullets.map((bullet, i) => (
        <div key={i} className="group">
          <div className="flex items-start gap-1.5">
            <span className="text-gray-400 dark:text-gray-500 text-xs mt-1.5 flex-shrink-0 select-none">•</span>
            <InlineTextarea
              value={bullet}
              onChange={(v) => {
                const next = [...bullets];
                next[i] = v;
                onChange(next);
              }}
              placeholder="Bullet point…"
              className="flex-1 text-sm text-gray-700 dark:text-gray-300"
            />
            <button
              onClick={() => onChange(bullets.filter((_, j) => j !== i))}
              title="Remove bullet"
              className="text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors text-xs mt-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100"
            >
              ✕
            </button>
          </div>
          {notesForBullet(i).map((n, idx) => (
            <div
              key={idx}
              className="ml-4 mt-1 rounded-lg bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/35 dark:text-amber-100"
            >
              {n.message}
            </div>
          ))}
        </div>
      ))}
      <div className="ml-4 mt-1">
        <AddBtn label="add bullet" onClick={() => onChange([...bullets, ""])} />
      </div>
    </div>
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────

function SummaryEditor({ content, onChange }: { content: string; onChange: (c: any) => void }) {
  return (
    <InlineTextarea
      value={content}
      onChange={onChange}
      placeholder="Write a professional summary…"
      className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed"
    />
  );
}

// ── Basics ───────────────────────────────────────────────────────────────────

function BasicsEditor({
  content,
  onChange,
  notes,
}: {
  content: Record<string, string>;
  onChange: (c: any) => void;
  notes?: Array<{ type: "error" | "warning" | "info"; message: string; target?: any }>;
}) {
  const updateField = (field: string, value: string) => onChange({ ...(content || {}), [field]: value });
  const notesForField = (field: string) =>
    (notes || []).filter((n) => n?.target?.kind === "field" && n?.target?.field === field);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <InlineInput
          value={content?.name || ""}
          onChange={(v) => updateField("name", v)}
          placeholder="Your Name"
          className="w-full text-lg font-semibold text-gray-900 dark:text-gray-100"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-[#1C1C1E]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Email</p>
            <InlineInput
              value={content?.email || ""}
              onChange={(v) => updateField("email", v)}
              placeholder="email@example.com"
              className="mt-1 w-full text-sm text-gray-700 dark:text-gray-300"
            />
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-[#1C1C1E]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Phone</p>
            <InlineInput
              value={content?.phone || ""}
              onChange={(v) => updateField("phone", v)}
              placeholder="(555) 555-5555"
              className="mt-1 w-full text-sm text-gray-700 dark:text-gray-300"
            />
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-[#1C1C1E]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Location</p>
            <InlineInput
              value={content?.location || ""}
              onChange={(v) => updateField("location", v)}
              placeholder="City, State"
              className="mt-1 w-full text-sm text-gray-700 dark:text-gray-300"
            />
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-[#1C1C1E]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">LinkedIn</p>
            <InlineInput
              value={content?.linkedin || ""}
              onChange={(v) => updateField("linkedin", v)}
              placeholder="linkedin.com/in/yourname"
              className="mt-1 w-full text-sm text-gray-700 dark:text-gray-300"
            />
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-[#1C1C1E]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">GitHub</p>
            <InlineInput
              value={content?.github || ""}
              onChange={(v) => updateField("github", v)}
              placeholder="github.com/yourname"
              className="mt-1 w-full text-sm text-gray-700 dark:text-gray-300"
            />
            {notesForField("github").map((n, idx) => (
              <p key={idx} className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                {n.message}
              </p>
            ))}
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-[#1C1C1E]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Portfolio</p>
            <InlineInput
              value={content?.portfolio || ""}
              onChange={(v) => updateField("portfolio", v)}
              placeholder="yourportfolio.com"
              className="mt-1 w-full text-sm text-gray-700 dark:text-gray-300"
            />
            {notesForField("portfolio").map((n, idx) => (
              <p key={idx} className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                {n.message}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Experience ───────────────────────────────────────────────────────────────

function ExperienceEntry({
  entry,
  onChange,
  onRemove,
  notes,
}: {
  entry: any;
  onChange: (e: any) => void;
  onRemove: () => void;
  notes?: Array<{ type: "error" | "warning" | "info"; message: string; target?: any }>;
}) {
  const upd = (field: string, val: string) => onChange({ ...entry, [field]: val });
  return (
    <div className="group border-b border-gray-100 py-3.5 dark:border-gray-700 last:border-0">
      <div className="relative rounded-xl pl-3 pr-1.5 transition-colors duration-150 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]">
        <div className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-brand-600/15 transition-colors duration-150 group-hover:bg-brand-600/28 dark:bg-brand-400/18 dark:group-hover:bg-brand-400/32" />
      {/* Resume-like header: company/location (left), dates (right), then job title */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <InlineInput
              value={entry.company || ""}
              onChange={(v) => upd("company", v)}
              placeholder="Company"
              className="min-w-[14ch] font-semibold text-gray-900 dark:text-gray-100 text-sm"
            />
            {entry.location !== undefined ? (
              <>
                <span className="text-gray-300 dark:text-gray-600 text-xs">•</span>
                <InlineInput
                  value={entry.location || ""}
                  onChange={(v) => upd("location", v)}
                  placeholder="Location"
                  className="min-w-[12ch] text-gray-500 dark:text-gray-400 text-xs"
                />
              </>
            ) : null}
          </div>
          <div className="mt-0.5">
            <InlineInput
              value={entry.title || ""}
              onChange={(v) => upd("title", v)}
              placeholder="Job Title"
              className="w-full text-sm font-medium text-gray-700 dark:text-gray-300"
            />
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <InlineInput
              value={entry.startDate || ""}
              onChange={(v) => upd("startDate", v)}
              placeholder="Start"
              className="text-gray-500 dark:text-gray-400 text-xs"
            />
            <span className="text-gray-300 dark:text-gray-600 text-xs">–</span>
            <InlineInput
              value={entry.endDate || ""}
              onChange={(v) => upd("endDate", v)}
              placeholder="End / Present"
              className="text-gray-500 dark:text-gray-400 text-xs"
            />
          </div>
          <RemoveBtn onClick={onRemove} />
        </div>
      </div>
      {/* Bullets */}
      <BulletList
        bullets={entry.bullets || []}
        onChange={(b) => onChange({ ...entry, bullets: b })}
        notes={notes}
      />
      </div>
    </div>
  );
}

function ExperienceEditor({
  content,
  onChange,
  notes,
}: {
  content: any[];
  onChange: (c: any) => void;
  notes?: Array<{ type: "error" | "warning" | "info"; message: string; target?: any }>;
}) {
  const empty = { company: "", title: "", location: "", startDate: "", endDate: "", bullets: [""] };
  return (
    <div>
      {content.map((entry, i) => (
        <ExperienceEntry
          key={i}
          entry={entry}
          onChange={(updated) => {
            const next = [...content];
            next[i] = updated;
            onChange(next);
          }}
          onRemove={() => onChange(content.filter((_, j) => j !== i))}
          notes={(notes || []).filter((n) => n?.target?.kind === "bullet" && n?.target?.entryIndex === i)}
        />
      ))}
      <div className="pt-2">
        <AddBtn label="add experience" onClick={() => onChange([...content, { ...empty }])} />
      </div>
    </div>
  );
}

// ── Education ────────────────────────────────────────────────────────────────

function EducationEntry({
  entry,
  onChange,
  onRemove,
}: {
  entry: any;
  onChange: (e: any) => void;
  onRemove: () => void;
}) {
  const upd = (field: string, val: string) => onChange({ ...entry, [field]: val });
  return (
    <div className="group border-b border-gray-100 py-3.5 dark:border-gray-700 last:border-0">
      <div className="relative rounded-xl pl-3 pr-1.5 transition-colors duration-150 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]">
        <div className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-brand-600/15 transition-colors duration-150 group-hover:bg-brand-600/28 dark:bg-brand-400/18 dark:group-hover:bg-brand-400/32" />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <InlineInput
              value={entry.institution || ""}
              onChange={(v) => upd("institution", v)}
              placeholder="Institution"
              className="min-w-[14ch] font-semibold text-gray-900 dark:text-gray-100 text-sm"
            />
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <InlineInput
              value={entry.degree || ""}
              onChange={(v) => upd("degree", v)}
              placeholder="Degree"
              className="min-w-[10ch] text-gray-800 dark:text-gray-200 text-sm"
            />
            <span className="text-gray-400 dark:text-gray-500 text-xs">·</span>
            <InlineInput
              value={entry.field || ""}
              onChange={(v) => upd("field", v)}
              placeholder="Field of Study"
              className="min-w-[12ch] text-gray-600 dark:text-gray-400 text-sm"
            />
            {entry.gpa !== undefined && (
              <>
                <span className="text-gray-300 dark:text-gray-600 text-xs">·</span>
                <span className="text-gray-400 dark:text-gray-500 text-xs">GPA</span>
                <InlineInput
                  value={entry.gpa || ""}
                  onChange={(v) => upd("gpa", v)}
                  placeholder="e.g. 3.8"
                  className="text-gray-500 dark:text-gray-400 text-xs"
                />
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <InlineInput
            value={entry.endDate || ""}
            onChange={(v) => upd("endDate", v)}
            placeholder="Year"
            className="text-gray-400 dark:text-gray-500 text-xs"
          />
          <RemoveBtn onClick={onRemove} />
        </div>
      </div>
      </div>
    </div>
  );
}

function EducationEditor({ content, onChange }: { content: any[]; onChange: (c: any) => void }) {
  return (
    <div>
      {content.map((entry, i) => (
        <EducationEntry
          key={i}
          entry={entry}
          onChange={(updated) => {
            const next = [...content];
            next[i] = updated;
            onChange(next);
          }}
          onRemove={() => onChange(content.filter((_, j) => j !== i))}
        />
      ))}
      <div className="pt-2">
        <AddBtn
          label="add education"
          onClick={() => onChange([...content, { institution: "", degree: "", field: "", endDate: "" }])}
        />
      </div>
    </div>
  );
}

// ── Projects ─────────────────────────────────────────────────────────────────

function ProjectEntry({
  entry,
  onChange,
  onRemove,
}: {
  entry: any;
  onChange: (e: any) => void;
  onRemove: () => void;
}) {
  const upd = (field: string, val: string) => onChange({ ...entry, [field]: val });
  return (
    <div className="group border-b border-gray-100 py-3.5 dark:border-gray-700 last:border-0">
      <div className="relative rounded-xl pl-3 pr-1.5 transition-colors duration-150 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]">
        <div className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-brand-600/15 transition-colors duration-150 group-hover:bg-brand-600/28 dark:bg-brand-400/18 dark:group-hover:bg-brand-400/32" />
      {/* Resume-like header: project (left), dates (right) */}
      <div className="flex items-start justify-between gap-3">
        <InlineInput
          value={entry.name || ""}
          onChange={(v) => upd("name", v)}
          placeholder="Project Name"
          className="min-w-0 flex-1 font-semibold text-gray-900 dark:text-gray-100 text-sm"
        />
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
            <InlineInput
              value={entry.startDate || ""}
              onChange={(v) => upd("startDate", v)}
              placeholder="Start"
              className="text-gray-400 dark:text-gray-500 text-xs"
            />
            <span className="text-gray-300 dark:text-gray-600 text-xs">–</span>
            <InlineInput
              value={entry.endDate || ""}
              onChange={(v) => upd("endDate", v)}
              placeholder="End / Present"
              className="text-gray-400 dark:text-gray-500 text-xs"
            />
          </div>
          <RemoveBtn onClick={onRemove} />
        </div>
      </div>
      <BulletList
        bullets={entry.bullets || []}
        onChange={(b) => onChange({ ...entry, bullets: b })}
      />
      </div>
    </div>
  );
}

function ProjectsEditor({ content, onChange }: { content: any[]; onChange: (c: any) => void }) {
  return (
    <div>
      {content.map((entry, i) => (
        <ProjectEntry
          key={i}
          entry={entry}
          onChange={(updated) => {
            const next = [...content];
            next[i] = updated;
            onChange(next);
          }}
          onRemove={() => onChange(content.filter((_, j) => j !== i))}
        />
      ))}
      <div className="pt-2">
        <AddBtn
          label="add project"
          onClick={() => onChange([...content, { name: "", startDate: "", endDate: "", bullets: [""] }])}
        />
      </div>
    </div>
  );
}

// ── Skills ───────────────────────────────────────────────────────────────────

function SkillsEditor({ content, onChange }: { content: any[]; onChange: (c: any) => void }) {
  return (
    <div className="space-y-3">
      {content.map((skill, i) => (
        <div key={i} className="group rounded-lg bg-gray-50/60 px-3 py-2 dark:bg-white/[0.04]">
          <div className="flex items-center gap-2">
            <InlineInput
              value={skill.category || ""}
              onChange={(v) => {
                const next = [...content];
                next[i] = { ...skill, category: v };
                onChange(next);
              }}
              placeholder="Category"
              className="font-medium text-gray-800 dark:text-gray-200 text-sm"
            />
            <div className="flex-1" />
            <RemoveBtn onClick={() => onChange(content.filter((_, j) => j !== i))} />
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {(Array.isArray(skill.items) ? skill.items : typeof skill.items === "string" ? skill.items.split(",").map((s: string) => s.trim()).filter(Boolean) : []).map(
              (item: string, j: number) => (
                <div
                  key={j}
                  className="flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 shadow-sm dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-200"
                >
                  <InlineInput
                    value={item}
                    onChange={(v) => {
                      const next = [...content];
                      const items = Array.isArray(skill.items)
                        ? [...skill.items]
                        : typeof skill.items === "string"
                          ? skill.items.split(",").map((s: string) => s.trim()).filter(Boolean)
                          : [];
                      items[j] = v;
                      next[i] = { ...skill, items: items.map((s: string) => s.trim()).filter(Boolean) };
                      onChange(next);
                    }}
                    placeholder="Skill"
                    className="text-xs text-gray-700 dark:text-gray-200"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...content];
                      const items = Array.isArray(skill.items)
                        ? [...skill.items]
                        : typeof skill.items === "string"
                          ? skill.items.split(",").map((s: string) => s.trim()).filter(Boolean)
                          : [];
                      next[i] = { ...skill, items: items.filter((_: string, idx: number) => idx !== j) };
                      onChange(next);
                    }}
                    className="ml-0.5 text-gray-300 hover:text-red-400 dark:text-gray-600 dark:hover:text-red-400"
                    aria-label="Remove skill"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              )
            )}

            <button
              type="button"
              onClick={() => {
                const next = [...content];
                const items = Array.isArray(skill.items)
                  ? [...skill.items]
                  : typeof skill.items === "string"
                    ? skill.items.split(",").map((s: string) => s.trim()).filter(Boolean)
                    : [];
                next[i] = { ...skill, items: [...items, ""] };
                onChange(next);
              }}
              className="rounded-full border border-dashed border-gray-200 bg-white px-2 py-1 text-xs text-gray-400 hover:text-brand-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-500 dark:hover:text-brand-400"
            >
              + Add skill
            </button>
          </div>
        </div>
      ))}
      <AddBtn
        label="add category"
        onClick={() => onChange([...content, { category: "", items: [] }])}
      />
    </div>
  );
}

// ── Certifications ───────────────────────────────────────────────────────────

function CertificationsEditor({ content, onChange }: { content: any[]; onChange: (c: any) => void }) {
  return (
    <div className="space-y-2">
      {content.map((cert, i) => (
        <div key={i} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 group">
          <InlineInput
            value={cert.name || ""}
            onChange={(v) => {
              const next = [...content];
              next[i] = { ...cert, name: v };
              onChange(next);
            }}
            placeholder="Certification Name"
            className="font-medium text-gray-800 dark:text-gray-200 text-sm"
          />
          <span className="text-gray-300 dark:text-gray-600 text-xs">·</span>
          <InlineInput
            value={cert.issuer || ""}
            onChange={(v) => {
              const next = [...content];
              next[i] = { ...cert, issuer: v };
              onChange(next);
            }}
            placeholder="Issuer"
            className="text-gray-500 dark:text-gray-400 text-xs"
          />
          <span className="text-gray-300 dark:text-gray-600 text-xs">·</span>
          <InlineInput
            value={cert.date || ""}
            onChange={(v) => {
              const next = [...content];
              next[i] = { ...cert, date: v };
              onChange(next);
            }}
            placeholder="Year"
            className="text-gray-400 dark:text-gray-500 text-xs"
          />
          <div className="flex-1" />
          <RemoveBtn onClick={() => onChange(content.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddBtn
        label="add certification"
        onClick={() => onChange([...content, { name: "", issuer: "", date: "" }])}
      />
    </div>
  );
}

// ── Awards ───────────────────────────────────────────────────────────────────

function AwardsEditor({ content, onChange }: { content: any[]; onChange: (c: any) => void }) {
  return (
    <div className="space-y-3">
      {content.map((award, i) => (
        <div key={i} className="pb-3 border-b border-gray-100 dark:border-gray-700 last:border-0 last:pb-0 group">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <InlineInput
              value={award.title || ""}
              onChange={(v) => {
                const next = [...content];
                next[i] = { ...award, title: v };
                onChange(next);
              }}
              placeholder="Award Title"
              className="font-medium text-gray-800 dark:text-gray-200 text-sm"
            />
            <span className="text-gray-300 dark:text-gray-600 text-xs">·</span>
            <InlineInput
              value={award.date || ""}
              onChange={(v) => {
                const next = [...content];
                next[i] = { ...award, date: v };
                onChange(next);
              }}
              placeholder="Year"
              className="text-gray-400 dark:text-gray-500 text-xs"
            />
            <div className="flex-1" />
            <RemoveBtn onClick={() => onChange(content.filter((_, j) => j !== i))} />
          </div>
          {award.summary !== undefined && (
            <InlineTextarea
              value={award.summary || ""}
              onChange={(v) => {
                const next = [...content];
                next[i] = { ...award, summary: v };
                onChange(next);
              }}
              placeholder="Brief description…"
              className="text-xs text-gray-500 dark:text-gray-400 mt-1"
            />
          )}
        </div>
      ))}
      <AddBtn
        label="add award"
        onClick={() => onChange([...content, { title: "", date: "", summary: "" }])}
      />
    </div>
  );
}

// ── Publications ─────────────────────────────────────────────────────────────

function PublicationsEditor({ content, onChange }: { content: any[]; onChange: (c: any) => void }) {
  return (
    <div className="space-y-3">
      {content.map((pub, i) => (
        <div key={i} className="pb-3 border-b border-gray-100 dark:border-gray-700 last:border-0 last:pb-0 group">
          <div className="flex items-baseline gap-2">
            <InlineInput
              value={pub.title || ""}
              onChange={(v) => {
                const next = [...content];
                next[i] = { ...pub, title: v };
                onChange(next);
              }}
              placeholder="Publication Title"
              className="font-medium text-gray-800 dark:text-gray-200 text-sm"
            />
            <div className="flex-1" />
            <RemoveBtn onClick={() => onChange(content.filter((_, j) => j !== i))} />
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <InlineInput
              value={pub.journal || pub.publisher || ""}
              onChange={(v) => {
                const next = [...content];
                next[i] = { ...pub, journal: v };
                onChange(next);
              }}
              placeholder="Journal / Publisher"
              className="text-gray-500 dark:text-gray-400 text-xs"
            />
            <span className="text-gray-300 dark:text-gray-600 text-xs">·</span>
            <InlineInput
              value={pub.date || ""}
              onChange={(v) => {
                const next = [...content];
                next[i] = { ...pub, date: v };
                onChange(next);
              }}
              placeholder="Year"
              className="text-gray-400 dark:text-gray-500 text-xs"
            />
          </div>
          {pub.summary !== undefined && (
            <InlineTextarea
              value={pub.summary || ""}
              onChange={(v) => {
                const next = [...content];
                next[i] = { ...pub, summary: v };
                onChange(next);
              }}
              placeholder="Abstract / description…"
              className="text-xs text-gray-500 dark:text-gray-400 mt-1"
            />
          )}
        </div>
      ))}
      <AddBtn
        label="add publication"
        onClick={() => onChange([...content, { title: "", journal: "", date: "", summary: "" }])}
      />
    </div>
  );
}

// ── Volunteer ────────────────────────────────────────────────────────────────

function VolunteerEditor({ content, onChange }: { content: any[]; onChange: (c: any) => void }) {
  const empty = { organization: "", role: "", startDate: "", endDate: "", bullets: [] };
  return (
    <div>
      {content.map((entry, i) => (
        <div key={i} className="group border-b border-gray-100 py-3.5 dark:border-gray-700 last:border-0">
          <div className="relative rounded-xl pl-3 pr-1.5 transition-colors duration-150 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]">
            <div className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-brand-600/15 transition-colors duration-150 group-hover:bg-brand-600/28 dark:bg-brand-400/18 dark:group-hover:bg-brand-400/32" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <InlineInput
                  value={entry.organization || entry.company || ""}
                  onChange={(v) => {
                    const next = [...content];
                    next[i] = { ...entry, organization: v };
                    onChange(next);
                  }}
                  placeholder="Organization"
                  className="min-w-[14ch] font-semibold text-gray-900 dark:text-gray-100 text-sm"
                />
              </div>
              <div className="mt-0.5">
                <InlineInput
                  value={entry.role || entry.title || ""}
                  onChange={(v) => {
                    const next = [...content];
                    next[i] = { ...entry, role: v };
                    onChange(next);
                  }}
                  placeholder="Role"
                  className="w-full text-sm text-gray-700 dark:text-gray-300"
                />
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1">
              <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <InlineInput
                  value={entry.startDate || ""}
                  onChange={(v) => {
                    const next = [...content];
                    next[i] = { ...entry, startDate: v };
                    onChange(next);
                  }}
                  placeholder="Start"
                  className="text-gray-400 dark:text-gray-500 text-xs"
                />
                <span className="text-gray-300 dark:text-gray-600 text-xs">–</span>
                <InlineInput
                  value={entry.endDate || ""}
                  onChange={(v) => {
                    const next = [...content];
                    next[i] = { ...entry, endDate: v };
                    onChange(next);
                  }}
                  placeholder="End / Present"
                  className="text-gray-400 dark:text-gray-500 text-xs"
                />
              </div>
              <RemoveBtn onClick={() => onChange(content.filter((_, j) => j !== i))} />
            </div>
          </div>
          {entry.bullets && (
            <BulletList
              bullets={entry.bullets}
              onChange={(b) => {
                const next = [...content];
                next[i] = { ...entry, bullets: b };
                onChange(next);
              }}
            />
          )}
          </div>
        </div>
      ))}
      <div className="pt-2">
        <AddBtn label="add volunteer" onClick={() => onChange([...content, { ...empty }])} />
      </div>
    </div>
  );
}

// ── Languages ────────────────────────────────────────────────────────────────

function LanguagesEditor({ content, onChange }: { content: any[]; onChange: (c: any) => void }) {
  return (
    <div className="space-y-2">
      {content.map((lang, i) => (
        <div key={i} className="flex items-baseline gap-2 group">
          <InlineInput
            value={lang.language || ""}
            onChange={(v) => {
              const next = [...content];
              next[i] = { ...lang, language: v };
              onChange(next);
            }}
            placeholder="Language"
            className="font-medium text-gray-800 dark:text-gray-200 text-sm"
          />
          <span className="text-gray-400 dark:text-gray-500 text-xs">·</span>
          <InlineInput
            value={lang.fluency || ""}
            onChange={(v) => {
              const next = [...content];
              next[i] = { ...lang, fluency: v };
              onChange(next);
            }}
            placeholder="Native / Fluent / Conversational"
            className="text-gray-500 dark:text-gray-400 text-sm"
          />
          <div className="flex-1" />
          <RemoveBtn onClick={() => onChange(content.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddBtn
        label="add language"
        onClick={() => onChange([...content, { language: "", fluency: "" }])}
      />
    </div>
  );
}

// ── Generic fallback ─────────────────────────────────────────────────────────

function GenericEditor({ content, onChange }: { content: any; onChange: (c: any) => void }) {
  if (typeof content === "string") {
    return (
      <InlineTextarea value={content} onChange={onChange} className="text-sm text-gray-700 dark:text-gray-300" />
    );
  }
  if (Array.isArray(content)) {
    return (
      <div className="space-y-1.5">
        {content.map((item, i) => (
          <div key={i} className="flex items-start gap-2 group">
            <span className="text-gray-400 dark:text-gray-500 text-xs mt-1.5 flex-shrink-0">•</span>
            <InlineTextarea
              value={typeof item === "string" ? item : JSON.stringify(item)}
              onChange={(v) => {
                const next = [...content];
                next[i] = v;
                onChange(next);
              }}
              className="flex-1 text-sm text-gray-700 dark:text-gray-300"
            />
            <button
              onClick={() => onChange(content.filter((_, j) => j !== i))}
              className="text-gray-300 dark:text-gray-600 hover:text-red-400 text-xs mt-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-colors"
            >
              ✕
            </button>
          </div>
        ))}
        <AddBtn label="add item" onClick={() => onChange([...content, ""])} />
      </div>
    );
  }
  return (
    <pre className="overflow-auto rounded p-2 text-xs text-gray-500 bg-gray-50 dark:bg-[#1C1C1E] dark:text-gray-400">
      {JSON.stringify(content, null, 2)}
    </pre>
  );
}

// ── ContentEditor dispatcher ─────────────────────────────────────────────────

function ContentEditor({
  sectionKey,
  content,
  onChange,
  notes,
}: {
  sectionKey: string;
  content: any;
  onChange: (c: any) => void;
  notes?: Array<{ type: "error" | "warning" | "info"; message: string; target?: any }>;
}) {
  switch (sectionKey) {
    case "basics":
      return <BasicsEditor content={content || {}} onChange={onChange} notes={notes} />;
    case "summary":
      return <SummaryEditor content={content} onChange={onChange} />;
    case "experience":
      return <ExperienceEditor content={content || []} onChange={onChange} notes={notes} />;
    case "education":
      return <EducationEditor content={content || []} onChange={onChange} />;
    case "skills":
      return <SkillsEditor content={content || []} onChange={onChange} />;
    case "projects":
      return <ProjectsEditor content={content || []} onChange={onChange} />;
    case "certifications":
      return <CertificationsEditor content={content || []} onChange={onChange} />;
    case "awards":
      return <AwardsEditor content={content || []} onChange={onChange} />;
    case "publications":
      return <PublicationsEditor content={content || []} onChange={onChange} />;
    case "volunteer":
      return <VolunteerEditor content={content || []} onChange={onChange} />;
    case "languages":
      return <LanguagesEditor content={content || []} onChange={onChange} />;
    default:
      return <GenericEditor content={content} onChange={onChange} />;
  }
}

// ── SectionBlock ─────────────────────────────────────────────────────────────

interface SectionBlockProps {
  sectionKey: string;
  content: any;
  hasOriginal: boolean;
  onChange: (content: any) => void;
  onReask: (feedback: string) => Promise<void>;
  onReset: () => void;
  showReask?: boolean;
  notes?: Array<{ type: "error" | "warning" | "info"; message: string; target?: any }>;
}

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function SectionBlock({
  sectionKey,
  content,
  hasOriginal,
  onChange,
  onReask,
  onReset,
  showReask = true,
  notes = [],
}: SectionBlockProps) {
  const remainingNotes = notes.filter((n) => !n?.target);
  const [reaskOpen, setReaskOpen] = useState(false);
  const [reaskText, setReaskText] = useState("");
  const [reaskLoading, setReaskLoading] = useState(false);
  const [reaskError, setReaskError] = useState<string | null>(null);

  async function handleReask() {
    if (!reaskText.trim()) return;
    setReaskLoading(true);
    setReaskError(null);
    try {
      await onReask(reaskText);
      setReaskText("");
      setReaskOpen(false);
    } catch (e: any) {
      setReaskError(e.message);
    } finally {
      setReaskLoading(false);
    }
  }

  return (
    <div className="group overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-[#3A3A3C] dark:bg-[#2C2C2E]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-[#3A3A3C]">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{formatKey(sectionKey)}</h3>
        <div
          className={`flex items-center gap-2 transition-opacity duration-150 ${
            reaskOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          {hasOriginal && (
            <button
              type="button"
              onClick={onReset}
              className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
            >
              Reset
            </button>
          )}
          {showReask && (
            <button
              type="button"
              onClick={() => setReaskOpen(!reaskOpen)}
              className="rounded-md bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-900/20 dark:text-brand-400 dark:hover:bg-brand-900/40"
            >
              Re-ask AI
            </button>
          )}
        </div>
      </div>

      {remainingNotes.length > 0 ? (
        <div className="border-b border-gray-100 bg-gray-50/60 px-5 py-3 dark:border-[#3A3A3C] dark:bg-white/[0.04]">
          <div className="space-y-2">
            {remainingNotes.map((n, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span
                  className={
                    n.type === "error"
                      ? "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                      : n.type === "warning"
                        ? "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                        : "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                  }
                >
                  {n.type}
                </span>
                <p className="text-sm text-gray-700 dark:text-gray-200">{n.message}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Content */}
      <div className="px-5 py-4">
        <ContentEditor sectionKey={sectionKey} content={content} onChange={onChange} notes={notes} />
      </div>

      {/* Re-ask panel */}
      {reaskOpen && (
        <div className="space-y-3 border-t border-gray-100 bg-gray-50 px-5 py-4 dark:border-[#3A3A3C] dark:bg-[#1C1C1E]">
          <textarea
            rows={3}
            placeholder="Tell the AI what to change in this section..."
            value={reaskText}
            onChange={(e) => setReaskText(e.target.value)}
            className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-[#3A3A3C] dark:bg-[#2C2C2E] dark:text-gray-100"
          />
          {reaskError && <p className="text-xs text-red-600 dark:text-red-400">{reaskError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setReaskOpen(false)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:border-[#3A3A3C] dark:text-gray-300 dark:hover:bg-[#3A3A3C]"
            >
              Cancel
            </button>
            <button
              onClick={handleReask}
              disabled={!reaskText.trim() || reaskLoading}
              className="px-4 py-1.5 text-sm bg-brand-600 text-white rounded-md font-medium disabled:opacity-40 hover:bg-brand-700"
            >
              {reaskLoading ? "Rewriting..." : "Rewrite Section"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
