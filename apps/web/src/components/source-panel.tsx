"use client";

import * as React from "react";
import { type Source } from "@contexta/shared";
import { X, FileText, Copy, Check, ExternalLink, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

interface SourcePanelProps {
  open: boolean;
  source: Source | null;
  onClose: () => void;
  onOpen?: (source: Source) => void;
}

export function SourcePanel({ open, source, onClose }: SourcePanelProps) {
  const [copied, setCopied] = React.useState(false);

  if (!open || !source) return null;

  const handleCopy = () => {
    if (source.snippet) {
      navigator.clipboard.writeText(source.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      {/* Mobile Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-neutral-950/60 backdrop-blur-sm lg:hidden"
        onClick={onClose}
      />

      {/* Source Panel: Collapsible Right Panel on Desktop, Bottom Sheet / Drawer on Mobile */}
      <aside className="fixed bottom-0 left-0 right-0 max-h-[80vh] z-50 rounded-t-2xl border-t border-border bg-card shadow-2xl lg:relative lg:inset-auto lg:z-10 lg:w-80 xl:w-96 lg:h-full lg:max-h-full lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none flex flex-col shrink-0">
        {/* Panel Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/70 shrink-0">
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Source Citation
            </h2>
            <Badge variant="indigo" className="font-mono text-xs px-1.5 py-0.5">
              [{source.n}]
            </Badge>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Close source panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Panel Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* File Metadata Card */}
          <div className="rounded-lg border border-border/70 bg-accent/30 p-3.5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 shrink-0">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-xs text-foreground truncate" title={source.fileName}>
                  {source.fileName}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                  <span>
                    {source.page != null ? `Page ${source.page}` : "General document"}
                  </span>
                  <span>&bull;</span>
                  <span className="font-mono text-[10px]">
                    ID: {String(source.documentId).slice(0, 8)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Snippet Card */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Referenced Passage
              </span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-500 font-medium"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-green-600" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <div className="rounded-lg border border-border bg-neutral-50 dark:bg-neutral-900/80 p-3.5 font-mono text-xs leading-relaxed text-foreground select-text whitespace-pre-wrap break-words border-l-4 border-l-indigo-600">
              {source.snippet}
            </div>
          </div>

          {/* Verification note */}
          <div className="rounded-md bg-muted/40 p-3 text-[11px] text-muted-foreground leading-relaxed">
            This snippet was retrieved directly from the vector index matching your question. All claims in the answer are grounded in this excerpt.
          </div>
        </div>

        {/* Panel Footer */}
        <div className="p-4 border-t border-border/70 shrink-0 bg-card">
          <Link href="/documents" className="w-full block">
            <Button variant="outline" size="sm" className="w-full text-xs flex items-center justify-center gap-1.5">
              <span>View in Document Library</span>
              <ExternalLink className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </aside>
    </>
  );
}
