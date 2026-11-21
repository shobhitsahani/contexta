"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "indigo";
}

const variants = {
  default: "border border-input bg-transparent text-muted-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  destructive: "border-border bg-destructive/10 text-destructive",
  indigo: "bg-indigo-600/10 border border-indigo-200/50 text-indigo-700 dark:text-indigo-300 dark:border-indigo-900/50 dark:bg-indigo-900/20",
};

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-none transition-colors",
        variants[variant],
        className,
      )}
      {...props}
    />
  ),
);
Badge.displayName = "Badge";
