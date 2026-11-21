"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SeparatorProps extends React.HTMLAttributes<HTMLHRElement> {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
}

export const Separator = React.forwardRef<HTMLHRElement, SeparatorProps>(
  ({ className, orientation = "horizontal", decorative = false, ...props }, ref) => (
    <hr
      ref={ref}
      className={cn(
        "relative flex w-full shrink-0 [&>hr]:bg-border [&>hr:h-px] [&>hr:w-full] border-t border-border",
        orientation === "vertical" ? "h-full w-px [&>hr:w-full] [&>hr:h-full] [&>hr:bg-transparent]" : "",
        className,
      )}
      {...(decorative ? { "aria-hidden": true } : {})}
      {...props}
    />
  ),
);
Separator.displayName = "Separator";
