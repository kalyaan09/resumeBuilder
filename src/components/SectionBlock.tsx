import { useState } from "react";

interface SectionBlockProps {
  sectionKey: string;
  content: any;
  hasOriginal: boolean;
  onChange: (content: any) => void;
  onReask: (feedback: string) => Promise<void>;
  onReset: () => void;
}

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ContentEditor({
  content,
  onChange,
}: {
  content: any;
  onChange: (c: any) => void;
}) {
  if (typeof content === "string") {
    return (
      <textarea
        className="w-full px-3 py-2 text-sm border border-transparent hover:border-gray-200 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 rounded-md resize-none bg-transparent"
        value={content}
        rows={Math.max(2, content.split("\n").length)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (Array.isArray(content)) {
    return (
      <div className="space-y-1.5">
        {content.map((item: any, i: number) => (
          <div key={i} className="flex gap-2 items-start">
            <span className="text-gray-400 mt-2 text-xs">•</span>
            {typeof item === "string" ? (
              <textarea
                className="flex-1 px-2 py-1.5 text-sm border border-transparent hover:border-gray-200 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 rounded-md resize-none bg-transparent"
                value={item}
                rows={Math.max(1, item.split("\n").length)}
                onChange={(e) => {
                  const updated = [...content];
                  updated[i] = e.target.value;
                  onChange(updated);
                }}
              />
            ) : (
              <div className="flex-1 space-y-1 border border-gray-100 rounded-md p-2">
                {Object.entries(item).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-xs text-gray-500 w-24 shrink-0 pt-1.5">{formatKey(k)}:</span>
                    <textarea
                      className="flex-1 px-2 py-1 text-sm border border-transparent hover:border-gray-200 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 rounded resize-none bg-transparent"
                      value={typeof v === "string" ? v : JSON.stringify(v)}
                      rows={1}
                      onChange={(e) => {
                        const updated = [...content];
                        updated[i] = { ...item, [k]: e.target.value };
                        onChange(updated);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (typeof content === "object" && content !== null) {
    return (
      <div className="space-y-2">
        {Object.entries(content).map(([k, v]) => (
          <div key={k} className="flex gap-3 items-start">
            <span className="text-xs text-gray-500 w-28 shrink-0 pt-1.5">{formatKey(k)}:</span>
            <textarea
              className="flex-1 px-2 py-1 text-sm border border-transparent hover:border-gray-200 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 rounded resize-none bg-transparent"
              value={typeof v === "string" ? v : JSON.stringify(v)}
              rows={Math.max(1, (typeof v === "string" ? v : "").split("\n").length)}
              onChange={(e) => onChange({ ...content, [k]: e.target.value })}
            />
          </div>
        ))}
      </div>
    );
  }

  return <pre className="text-xs text-gray-500">{JSON.stringify(content, null, 2)}</pre>;
}

export default function SectionBlock({
  sectionKey,
  content,
  hasOriginal,
  onChange,
  onReask,
  onReset,
}: SectionBlockProps) {
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
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-800 text-sm">{formatKey(sectionKey)}</h3>
        <div className="flex items-center gap-2">
          {hasOriginal && (
            <button
              onClick={onReset}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
            >
              Reset
            </button>
          )}
          <button
            onClick={() => setReaskOpen(!reaskOpen)}
            className="text-xs bg-brand-50 text-brand-700 hover:bg-brand-100 px-3 py-1 rounded-md font-medium"
          >
            Re-ask AI
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-5 py-4">
        <ContentEditor content={content} onChange={onChange} />
      </div>

      {/* Re-ask panel */}
      {reaskOpen && (
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-3">
          <textarea
            rows={3}
            placeholder="Tell the AI what to change in this section..."
            value={reaskText}
            onChange={(e) => setReaskText(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          />
          {reaskError && (
            <p className="text-xs text-red-600">{reaskError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setReaskOpen(false)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-100"
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
