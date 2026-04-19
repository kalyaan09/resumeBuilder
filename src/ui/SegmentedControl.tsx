import { motion } from "framer-motion";
import { useId } from "react";
import { cn } from "./cn";

export type SegmentedOption<T extends string> = { value: T; label: string };

/**
 * Apple-style segmented control: recessed track, floating thumb with soft shadow (no outer stroke).
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
  layoutId,
}: {
  value: T;
  onChange: (next: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
  size?: "sm" | "md";
  /** Unique per control when multiple on screen */
  layoutId?: string;
}) {
  const autoId = useId().replace(/:/g, "");
  const thumbId = layoutId ?? `segmented-${autoId}`;

  return (
    <div
      role="tablist"
      className={cn(
        "relative inline-flex w-full max-w-full rounded-[10px]",
        /* Recessed track — iOS system gray, no outer ring */
        "bg-[#E5E5EA] p-[3px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] dark:bg-[#2C2C2E] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]",
        className
      )}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative z-0 flex min-w-0 items-center justify-center rounded-[7px] font-medium outline-none transition-colors duration-150",
              "focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-brand-500/35 focus-visible:ring-offset-0",
              size === "sm"
                ? "min-h-[28px] min-w-[2.1rem] flex-1 px-1.5 py-1 text-[13px] tabular-nums sm:min-w-[2.35rem] sm:px-2"
                : "min-h-[32px] min-w-[2.5rem] flex-1 px-2 py-1.5 text-sm",
              active
                ? "font-semibold text-gray-900 dark:text-white"
                : "font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            )}
          >
            {active && (
              <motion.span
                layoutId={thumbId}
                className={cn(
                  /* Nearly full segment — tiny gutter so highlight matches digit width */
                  "absolute -z-10 inset-[2px] rounded-[6px]",
                  "bg-white shadow-[0_2px_6px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.06)]",
                  "dark:bg-[#48484A] dark:shadow-[0_2px_8px_rgba(0,0,0,0.45),0_1px_2px_rgba(0,0,0,0.25)]"
                )}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative whitespace-nowrap leading-none">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
