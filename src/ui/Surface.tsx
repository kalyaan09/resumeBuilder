import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./cn";

const surfaceVariants = cva("rounded-card transition-colors duration-200", {
  variants: {
    variant: {
      panel:
        "border border-white/50 bg-surface-glass shadow-glass backdrop-blur-xl dark:border-white/10 dark:bg-surface-glass-dark dark:shadow-glass-dark dark:backdrop-blur-2xl",
      rail: "border-r border-white/45 bg-surface-rail backdrop-blur-lg dark:border-white/10 dark:bg-surface-rail-dark dark:backdrop-blur-xl",
      inset:
        "border border-white/50 bg-surface-inset backdrop-blur-md dark:border-white/10 dark:bg-surface-inset-dark dark:backdrop-blur-lg",
      solid:
        "border border-gray-200/70 bg-white shadow-card dark:border-white/10 dark:bg-[#2C2C2E] dark:shadow-card-dark",
    },
  },
  defaultVariants: { variant: "panel" },
});

export interface SurfaceProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof surfaceVariants> {}

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { className, variant, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      data-surface={variant ?? "panel"}
      className={cn(surfaceVariants({ variant }), className)}
      {...props}
    />
  );
});
