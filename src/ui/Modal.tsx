import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Button } from "./Button";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  contentClassName,
  showClose = true,
  footer,
  /** Compact height (e.g. confirmations); default is tall for PDF previews */
  dense = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: string;
  children: ReactNode;
  /** Outer wrapper (positioning + max size) */
  className?: string;
  /** Inner frosted shell */
  contentClassName?: string;
  showClose?: boolean;
  footer?: ReactNode;
  dense?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-md" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(900px,96vw)] max-w-[96vw] -translate-x-1/2 -translate-y-1/2 focus:outline-none",
            className
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className={cn(
              "flex max-h-[94vh] flex-col overflow-hidden rounded-2xl border border-gray-200/60 bg-surface-glass shadow-glass backdrop-blur-xl dark:border-white/10 dark:bg-surface-glass-dark dark:shadow-glass-dark",
              dense ? "min-h-0" : "min-h-[520px]",
              contentClassName
            )}
          >
            {title || showClose ? (
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200/60 px-4 py-2 dark:border-white/10">
                <div className="min-w-0">
                  {title ? (
                    <Dialog.Title className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {title}
                    </Dialog.Title>
                  ) : (
                    <Dialog.Title className="sr-only">Dialog</Dialog.Title>
                  )}
                  {description ? (
                    <Dialog.Description className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {description}
                    </Dialog.Description>
                  ) : null}
                </div>
                {showClose && (
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="icon" className="shrink-0 rounded-full" aria-label="Close">
                      <X className="h-4 w-4 opacity-70" />
                    </Button>
                  </Dialog.Close>
                )}
              </div>
            ) : (
              <>
                <Dialog.Title className="sr-only">Dialog</Dialog.Title>
                {description ? <Dialog.Description className="sr-only">{description}</Dialog.Description> : null}
              </>
            )}
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            {footer ? (
              <div className="shrink-0 border-t border-gray-200/60 bg-white/40 px-4 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                {footer}
              </div>
            ) : null}
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
