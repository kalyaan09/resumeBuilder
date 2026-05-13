import { ChevronDown, ChevronUp } from "lucide-react";
import { SECTION_LABELS } from "../lib/sectionOrder";

export default function SectionOrderEditor({
  orderedKeys,
  onReorder,
  disabled,
  onRemove,
  canRemove,
}: {
  orderedKeys: string[];
  onReorder: (next: string[]) => void;
  disabled?: boolean;
  onRemove?: (key: string) => void;
  canRemove?: (key: string) => boolean;
}) {
  const n = orderedKeys.length;

  function reorder(from: number, to: number) {
    if (from === to || disabled) return;
    if (from < 0 || to < 0 || from >= n || to >= n) return;
    const next = [...orderedKeys];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onReorder(next);
  }

  return (
    <div className="space-y-1.5">
      {orderedKeys.map((s, i) => (
        <div
          key={s}
          data-section-row
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-600 dark:bg-gray-700"
        >
          <div className="flex shrink-0 flex-col gap-0.5">
            <button
              type="button"
              disabled={disabled || i === 0}
              aria-label={`Move ${SECTION_LABELS[s] || s} up`}
              title="Move up"
              className="rounded p-0.5 text-gray-500 hover:bg-gray-200/80 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-35 dark:text-gray-400 dark:hover:bg-gray-600/80 dark:hover:text-gray-100"
              onClick={() => reorder(i, i - 1)}
            >
              <ChevronUp className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              disabled={disabled || i >= n - 1}
              aria-label={`Move ${SECTION_LABELS[s] || s} down`}
              title="Move down"
              className="rounded p-0.5 text-gray-500 hover:bg-gray-200/80 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-35 dark:text-gray-400 dark:hover:bg-gray-600/80 dark:hover:text-gray-100"
              onClick={() => reorder(i, i + 1)}
            >
              <ChevronDown className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          </div>
          <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{SECTION_LABELS[s] || s}</span>
          {onRemove && (canRemove ? canRemove(s) : true) ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(s)}
              className="rounded-md px-2 py-1 text-sm text-gray-300 transition-colors hover:text-red-600 disabled:opacity-40 dark:text-gray-600 dark:hover:text-red-400"
              aria-label={`Remove ${SECTION_LABELS[s] || s}`}
              title="Remove"
            >
              ✕
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
