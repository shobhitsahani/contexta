"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { AppProvider } from "@/context/app-context";
import { X, Menu, Sun, Moon, MessageSquare, FileText, Settings } from "lucide-react";
import { useTheme } from "@/lib/theme";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { toggle, theme, resolved } = useTheme();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const pathname = usePathname();

  return (
    <AppProvider>
      <div className="flex flex-col md:flex-row h-screen w-screen overflow-hidden bg-background text-foreground">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0 z-20">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileDrawerOpen(true)}
              className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white font-semibold text-xs shadow-sm">
                C
              </div>
              <span className="font-semibold tracking-tight text-sm">Contexta</span>
            </Link>
          </div>

          <button
            onClick={() => toggle(theme === "light" ? "dark" : "light")}
            aria-label="Toggle theme"
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            {resolved === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>

        {/* Desktop sidebar */}
        <Sidebar />

        {/* Main content container */}
        <main className="flex-1 min-w-0 h-full flex flex-col overflow-y-auto bg-background">
          {children}
        </main>

        {/* Mobile drawer overlay */}
        {mobileDrawerOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div
              className="absolute inset-0 bg-neutral-950/60 backdrop-blur-sm"
              onClick={() => setMobileDrawerOpen(false)}
            />
            <aside className="relative w-72 max-w-[85vw] h-full bg-card border-r border-border shadow-2xl p-5 flex flex-col z-10">
              <div className="flex items-center justify-between pb-4 border-b border-border/60 mb-4">
                <Link
                  href="/dashboard"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="flex items-center gap-2"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white font-semibold text-xs">
                    C
                  </div>
                  <span className="font-semibold tracking-tight text-sm">Contexta</span>
                </Link>
                <button
                  onClick={() => setMobileDrawerOpen(false)}
                  className="p-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <nav className="space-y-1.5">
                {[
                  { href: "/dashboard", label: "Chats", icon: MessageSquare },
                  { href: "/documents", label: "Documents", icon: FileText },
                  { href: "/settings", label: "Settings", icon: Settings },
                ].map((item) => {
                  const Icon = item.icon;
                  const active =
                    item.href === "/dashboard"
                      ? pathname?.startsWith("/dashboard")
                      : pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileDrawerOpen(false)}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>

              <div className="mt-auto pt-4 border-t border-border flex items-center justify-between">
                <button
                  onClick={() => toggle(theme === "light" ? "dark" : "light")}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  {resolved === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  <span>{resolved === "dark" ? "Light theme" : "Dark theme"}</span>
                </button>
                <Link
                  href="/login"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Sign out
                </Link>
              </div>
            </aside>
          </div>
        )}
      </div>
    </AppProvider>
  );
}
