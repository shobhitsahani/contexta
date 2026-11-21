"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageSquare,
  FileText,
  Settings,
  LogOut,
  Plus,
  Pin,
  Trash2,
  Edit2,
  Sun,
  Moon,
  UploadCloud,
  Check,
  X,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useApp } from "@/context/app-context";
import { authApi } from "@/lib/api";
import { type AppChat } from "@/lib/types";
import { type Document } from "@contexta/shared";

const NAV = [
  { href: "/dashboard", icon: MessageSquare, label: "Chats" },
  { href: "/documents", icon: FileText, label: "Documents" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const router = useRouter();
  const { toggle, theme, resolved } = useTheme();
  const {
    chats,
    currentChatId,
    setCurrentChatId,
    createChat,
    renameChat,
    togglePinChat,
    deleteChat,
    documents,
  } = useApp();
  const pathname = usePathname();

  const pinned = chats.filter((c) => c.pinned);
  const recent = chats.filter((c) => !c.pinned);

  const handleSignOut = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    router.push("/login");
  };

  const handleSelectChat = (id: string) => {
    setCurrentChatId(id);
    router.push(`/dashboard/${id}`);
  };

  const handleNewChat = () => {
    createChat();
    router.push("/dashboard");
  };

  return (
    <aside className="hidden md:flex flex-col w-64 lg:w-72 h-full border-r border-border bg-card/60 backdrop-blur shrink-0">
      {/* App Branding & Theme */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white font-semibold text-xs shadow-sm">
            C
          </div>
          <div className="flex flex-col">
            <span className="font-semibold tracking-tight text-sm text-foreground">
              Contexta
            </span>
            <span className="text-[10px] text-muted-foreground leading-none">
              Knowledge Assistant
            </span>
          </div>
        </Link>
        <button
          onClick={() => toggle(theme === "light" ? "dark" : "light")}
          aria-label="Toggle theme"
          className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          {resolved === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>

      {/* Main Navigation */}
      <div className="px-3 py-3 border-b border-border/40">
        <nav className="space-y-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/dashboard"
                ? pathname?.startsWith("/dashboard")
                : pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 font-semibold"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Chats Section */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* New Chat Button */}
        <button
          onClick={handleNewChat}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 text-xs font-medium shadow-sm transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New chat</span>
        </button>

        {/* Pinned Chats */}
        {pinned.length > 0 && (
          <div>
            <div className="px-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Pin className="h-2.5 w-2.5 text-indigo-500" />
              <span>Pinned</span>
            </div>
            <div className="space-y-0.5">
              {pinned.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  active={currentChatId === chat.id}
                  onSelect={handleSelectChat}
                  onRename={renameChat}
                  onTogglePin={togglePinChat}
                  onDelete={deleteChat}
                />
              ))}
            </div>
          </div>
        )}

        {/* Recent Chats */}
        <div>
          <div className="px-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            Recent chats
          </div>
          {recent.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-muted-foreground/80 italic text-center rounded-lg border border-dashed border-border/60">
              No recent conversations
            </div>
          ) : (
            <div className="space-y-0.5">
              {recent.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  active={currentChatId === chat.id}
                  onSelect={handleSelectChat}
                  onRename={renameChat}
                  onTogglePin={togglePinChat}
                  onDelete={deleteChat}
                />
              ))}
            </div>
          )}
        </div>

        {/* Documents Quick Peek */}
        <div className="pt-2 border-t border-border/40">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Documents ({documents.length})
            </span>
            <Link
              href="/documents"
              className="text-[11px] text-indigo-600 hover:underline flex items-center gap-0.5"
            >
              <span>View all</span>
            </Link>
          </div>

          <div className="space-y-1">
            {documents.slice(0, 4).map((doc) => (
              <DocumentRowMini key={doc.id} doc={doc} />
            ))}
            {documents.length === 0 && (
              <Link
                href="/documents"
                className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-dashed border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-indigo-400 transition-colors"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                <span>Upload a document</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Footer / Sign Out */}
      <div className="border-t border-border/60 px-4 py-3 shrink-0">
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}

function ChatRow({
  chat,
  active,
  onSelect,
  onRename,
  onTogglePin,
  onDelete,
}: {
  chat: AppChat;
  active: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [localTitle, setLocalTitle] = useState(chat.title);

  const saveRename = () => {
    setRenaming(false);
    if (localTitle.trim()) {
      onRename(chat.id, localTitle.trim());
    } else {
      setLocalTitle(chat.title);
    }
  };

  if (renaming) {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-accent">
        <input
          autoFocus
          className="flex-1 bg-background border border-indigo-500 rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none"
          value={localTitle}
          onChange={(e) => setLocalTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveRename();
            if (e.key === "Escape") {
              setRenaming(false);
              setLocalTitle(chat.title);
            }
          }}
        />
        <button
          onClick={saveRename}
          className="p-1 rounded text-green-600 hover:bg-green-100 dark:hover:bg-green-950/40"
          title="Save"
        >
          <Check className="h-3 w-3" />
        </button>
        <button
          onClick={() => {
            setRenaming(false);
            setLocalTitle(chat.title);
          }}
          className="p-1 rounded text-muted-foreground hover:bg-accent"
          title="Cancel"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={() => onSelect(chat.id)}
      className={`group flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${
        active
          ? "bg-accent text-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${
            active ? "bg-indigo-600" : "bg-neutral-300 dark:bg-neutral-600"
          }`}
        />
        <span className="truncate">{chat.title}</span>
      </div>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setRenaming(true);
          }}
          aria-label="Rename chat"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background/80"
          title="Rename"
        >
          <Edit2 className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(chat.id);
          }}
          aria-label={chat.pinned ? "Unpin chat" : "Pin chat"}
          className={`p-1 rounded hover:bg-background/80 ${
            chat.pinned
              ? "text-indigo-600 dark:text-indigo-400"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title={chat.pinned ? "Unpin" : "Pin"}
        >
          <Pin className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete chat "${chat.title}"?`)) {
              onDelete(chat.id);
            }
          }}
          aria-label="Delete chat"
          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-background/80"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function DocumentRowMini({ doc }: { doc: Document }) {
  const statusStyles: Record<string, string> = {
    queued: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
    parsing: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 animate-pulse",
    embedding: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 animate-pulse",
    ready: "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400",
    failed: "bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive",
  };

  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-md text-[11px] hover:bg-accent/50 transition-colors">
      <div className="flex items-center gap-1.5 truncate">
        <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="truncate text-foreground/90">{doc.name}</span>
      </div>
      <span
        className={`px-1.5 py-0.2 rounded text-[9px] font-medium shrink-0 ${
          statusStyles[doc.status] || statusStyles.queued
        }`}
      >
        {doc.status}
      </span>
    </div>
  );
}
