import SectionBlock from "./SectionBlock";
import { TypographyMuted } from "../ui";

interface ResumeEditorProps {
  sections: Record<string, any>;
  originalSections: Record<string, any> | null;
  onSectionChange: (key: string, content: any) => void;
  onReaskSection: (key: string, feedback: string) => Promise<void>;
  onResetSection: (key: string) => void;
  label?: string;
  showReask?: boolean;
  suggestions?: Array<{ section: string; type: "error" | "warning" | "info"; message: string }> | null;
}

type Note = { type: "error" | "warning" | "info"; message: string; target?: unknown };

export default function ResumeEditor({
  sections,
  originalSections,
  onSectionChange,
  onReaskSection,
  onResetSection,
  label = "Edited Resume",
  showReask = true,
  suggestions = null,
}: ResumeEditorProps) {
  function targetBasicsNotes(notes: Note[]): Note[] {
    const fields: Array<{ field: string; rx: RegExp }> = [
      { field: "github", rx: /\bgithub\b/i },
      { field: "portfolio", rx: /\bportfolio\b/i },
      { field: "linkedin", rx: /\blinkedin\b/i },
      { field: "email", rx: /\bemail\b/i },
      { field: "phone", rx: /\bphone\b/i },
      { field: "location", rx: /\blocation\b/i },
      { field: "name", rx: /\bname\b/i },
    ];
    return notes.map((n) => {
      const hit = fields.find((f) => f.rx.test(n.message));
      return hit ? { ...n, target: { kind: "field", field: hit.field } } : n;
    });
  }

  function targetExperienceNotes(entries: any[], notes: Note[]): Note[] {
    // Try to attach notes to a specific bullet based on quoted text or a strong snippet match.
    const extractQuoted = (msg: string) => {
      const m = msg.match(/'([^']+)'/);
      return m?.[1]?.trim() || "";
    };

    return notes.map((n) => {
      const quoted = extractQuoted(n.message);
      const needle = (quoted || "").toLowerCase();
      if (!needle) return n;

      for (let ei = 0; ei < entries.length; ei++) {
        const bullets: string[] = Array.isArray(entries[ei]?.bullets) ? entries[ei].bullets : [];
        for (let bi = 0; bi < bullets.length; bi++) {
          const b = (bullets[bi] || "").toLowerCase();
          if (b.includes(needle)) return { ...n, target: { kind: "bullet", entryIndex: ei, bulletIndex: bi } };
        }
      }
      return n;
    });
  }

  return (
    <div className="space-y-4">
      {label ? (
        <TypographyMuted className="text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-400">
          {label}
        </TypographyMuted>
      ) : null}
      {Object.entries(sections).map(([key, content]) => {
        const raw: Note[] = suggestions
          ? suggestions.filter((s) => s.section === key).map((s) => ({ type: s.type, message: s.message }))
          : [];

        const targeted =
          key === "basics"
            ? targetBasicsNotes(raw)
            : key === "experience" && Array.isArray(content)
              ? targetExperienceNotes(content, raw)
              : raw;

        return (
          <SectionBlock
            key={key}
            sectionKey={key}
            content={content}
            hasOriginal={originalSections?.[key] !== undefined}
            onChange={(newContent) => onSectionChange(key, newContent)}
            onReask={(feedback) => onReaskSection(key, feedback)}
            onReset={() => onResetSection(key)}
            showReask={showReask}
            notes={targeted}
          />
        );
      })}
    </div>
  );
}
