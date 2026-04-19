import SectionBlock from "./SectionBlock";

interface ResumeEditorProps {
  sections: Record<string, any>;
  originalSections: Record<string, any> | null;
  onSectionChange: (key: string, content: any) => void;
  onReaskSection: (key: string, feedback: string) => Promise<void>;
  onResetSection: (key: string) => void;
  label?: string;
  showReask?: boolean;
}

export default function ResumeEditor({
  sections,
  originalSections,
  onSectionChange,
  onReaskSection,
  onResetSection,
  label = "Edited Resume",
  showReask = true,
}: ResumeEditorProps) {
  return (
    <div className="space-y-4">
      {label ? (
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-400">{label}</h2>
      ) : null}
      {Object.entries(sections).map(([key, content]) => (
        <SectionBlock
          key={key}
          sectionKey={key}
          content={content}
          hasOriginal={originalSections?.[key] !== undefined}
          onChange={(newContent) => onSectionChange(key, newContent)}
          onReask={(feedback) => onReaskSection(key, feedback)}
          onReset={() => onResetSection(key)}
          showReask={showReask}
        />
      ))}
    </div>
  );
}
