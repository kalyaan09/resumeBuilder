import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { SECTION_LABELS } from "../lib/sectionOrder";

/** Full-row drag preview (native DnD only snapshots the draggable node by default, usually the grip). */
function mountSectionDragGhost(
  row: HTMLElement,
  clientX: number,
  clientY: number,
  dataTransfer: DataTransfer
): HTMLDivElement {
  const clone = row.cloneNode(true) as HTMLDivElement;
  clone.querySelectorAll("button").forEach((el) => el.remove());
  const rect = row.getBoundingClientRect();
  clone.style.width = `${rect.width}px`;
  clone.style.boxSizing = "border-box";
  clone.style.position = "fixed";
  clone.style.top = "-9999px";
  clone.style.left = "-9999px";
  clone.style.margin = "0";
  clone.style.pointerEvents = "none";
  clone.style.zIndex = "2147483647";
  clone.style.transition = "none";
  clone.style.opacity = "1";
  clone.classList.remove("opacity-50", "opacity-60");
  const dark = document.documentElement.classList.contains("dark");
  clone.style.boxShadow = dark
    ? "0 20px 44px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)"
    : "0 20px 44px rgba(15,23,42,0.14), 0 0 0 1px rgba(15,23,42,0.08)";
  document.body.appendChild(clone);
  const ox = clientX - rect.left;
  const oy = clientY - rect.top;
  dataTransfer.setDragImage(clone, ox, oy);
  return clone;
}

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
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);

  function reorder(from: number, to: number) {
    if (from === to || disabled) return;
    const n = orderedKeys.length;
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
          className={`flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 transition-[opacity,box-shadow,background-color,border-color] duration-200 ease-out dark:border-gray-600 dark:bg-gray-700 ${
            dragOverIndex === i && dragIndex !== i
              ? "border-brand-400/70 bg-brand-50/50 ring-1 ring-brand-400/40 dark:bg-brand-950/20"
              : ""
          } ${dragIndex === i ? "opacity-45" : ""}`}
          onDragOver={(e) => {
            if (disabled) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragIndex !== null && dragIndex !== i) {
              setDragOverIndex(i);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDragOverIndex((prev) => (prev === i ? null : prev));
            }
          }}
          onDrop={(e) => {
            if (disabled) return;
            e.preventDefault();
            const raw =
              e.dataTransfer.getData("application/x-section-index") || e.dataTransfer.getData("text/plain");
            const from = parseInt(raw, 10);
            if (!Number.isNaN(from)) reorder(from, i);
            setDragIndex(null);
            setDragOverIndex(null);
          }}
        >
          <div
            draggable={!disabled}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-label={`Reorder ${SECTION_LABELS[s] || s}`}
            title={disabled ? undefined : "Drag to reorder"}
            className="-ml-0.5 flex shrink-0 touch-none rounded p-0.5 text-gray-400 hover:text-gray-600 active:cursor-grabbing dark:text-gray-500 dark:hover:text-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
            onDragStart={(e) => {
              if (disabled) {
                e.preventDefault();
                return;
              }
              const row = (e.currentTarget as HTMLElement).closest("[data-section-row]");
              if (row) {
                ghostRef.current?.remove();
                ghostRef.current = mountSectionDragGhost(row as HTMLElement, e.clientX, e.clientY, e.dataTransfer);
              }
              const id = String(i);
              e.dataTransfer.setData("application/x-section-index", id);
              e.dataTransfer.setData("text/plain", id);
              e.dataTransfer.effectAllowed = "move";
              setDragIndex(i);
            }}
            onDragEnd={() => {
              ghostRef.current?.remove();
              ghostRef.current = null;
              setDragIndex(null);
              setDragOverIndex(null);
            }}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "ArrowUp" && i > 0) {
                e.preventDefault();
                reorder(i, i - 1);
              } else if (e.key === "ArrowDown" && i < orderedKeys.length - 1) {
                e.preventDefault();
                reorder(i, i + 1);
              }
            }}
          >
            <GripVertical className="h-4 w-4" strokeWidth={2} aria-hidden />
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
