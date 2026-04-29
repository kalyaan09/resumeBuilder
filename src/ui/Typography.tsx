import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export function TypographyH2({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("scroll-m-20 border-b border-gray-200/70 pb-2 text-3xl font-semibold tracking-tight first:mt-0 dark:border-white/10", className)}
      {...props}
    />
  );
}

export function TypographyP({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("leading-7 [&:not(:first-child)]:mt-6", className)} {...props} />;
}

export function TypographyMuted({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-gray-500 dark:text-gray-400", className)} {...props} />;
}

