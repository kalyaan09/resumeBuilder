import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-btn text-sm font-medium transition-all duration-150",
    "focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98]",
    /**
     * Icon ergonomics:
     * - default size for any direct svg icon
     * - optional data-icon for optical alignment (like your reference)
     */
    /**
     * Use descendant selectors (not direct child) so icons work even if wrapped
     * by other components/spans.
     */
    "[&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
    "[&_[data-icon='inline-start']]:-ml-0.5 [&_[data-icon='inline-end']]:-mr-0.5",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
        secondary:
          "border border-gray-300/90 bg-white/85 text-gray-900 shadow-sm backdrop-blur-sm hover:bg-white dark:border-white/12 dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/[0.14]",
        ghost:
          "text-gray-700 hover:bg-black/[0.05] dark:text-gray-200 dark:hover:bg-white/[0.08]",
        destructive:
          "border border-red-200/90 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800/80 dark:bg-red-950/45 dark:text-red-300 dark:hover:bg-red-950/65",
        /** Primary action without a heavy solid fill — border + brand text */
        outlinePrimary:
          "border border-brand-600 bg-white text-brand-600 shadow-sm hover:bg-brand-50 hover:border-brand-700 dark:border-brand-500 dark:bg-[#2C2C2E] dark:text-brand-400 dark:hover:bg-white/[0.08] dark:hover:border-brand-400",
        /**
         * Primary CTAs — same height as default controls; gradient kept subtle
         */
        cta:
          "h-10 rounded-lg border border-brand-500/20 bg-gradient-to-b from-brand-500 to-brand-700 px-4 py-0 text-sm font-semibold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_8px_rgba(37,99,235,0.28)] hover:from-brand-600 hover:to-brand-800 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_3px_10px_rgba(37,99,235,0.32)] active:scale-[0.99] dark:border-brand-400/12 dark:from-brand-600 dark:to-brand-900 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_2px_10px_rgba(0,0,0,0.28)] dark:hover:from-brand-600 dark:hover:to-brand-950",
        link: "text-brand-600 underline-offset-4 hover:underline dark:text-brand-400",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3 text-xs",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9 shrink-0 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref
) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
