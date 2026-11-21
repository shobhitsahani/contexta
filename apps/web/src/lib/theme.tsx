"use client";

import * as React from "react";
import {
  type Theme,
  getStoredTheme,
  getSystemTheme,
  resolveTheme,
  applyTheme,
} from "./theme-core";

export type { Theme };
export { getStoredTheme, getSystemTheme, resolveTheme, applyTheme };

const THEME_STORAGE_KEY = "contexta-theme";

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [theme, setTheme] = React.useState<Theme>("system");
  const [resolved, setResolved] = React.useState<"light" | "dark">("light");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored ?? "system");
    const next = resolveTheme(stored);
    setResolved(next);
    applyTheme(next);
    setMounted(true);
  }, []);

  const toggle = React.useCallback(
    (next: Theme) => {
      setTheme(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // ignore
      }
      const resolvedTheme = resolveTheme(next);
      setResolved(resolvedTheme);
      applyTheme(resolvedTheme);
    },
    []
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") {
        const resolvedTheme = resolveTheme("system");
        setResolved(resolvedTheme);
        applyTheme(resolvedTheme);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  if (!mounted) {
    return null;
  }

  return (
    <ThemeContext.Provider value={{ theme, resolved, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

const ThemeContext = React.createContext<{
  theme: Theme;
  resolved: "light" | "dark";
  toggle: (next: Theme) => void;
} | null>(null);

export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
