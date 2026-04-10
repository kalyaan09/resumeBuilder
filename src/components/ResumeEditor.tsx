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
      <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">
        {label}
      </h2>
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
