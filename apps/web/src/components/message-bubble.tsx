"use client";

import * as React from "react";
import { type Message, type Source } from "@contexta/shared";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Sparkles, User, FileText } from "lucide-react";

interface MessageBubbleProps {
  message: Message;
  streaming: boolean;
  onToggleSource: (source: Source) => void;
}

export function MessageBubble({
  message,
  streaming,
  onToggleSource,
}: MessageBubbleProps) {
  const isAssistant = message.role === "assistant";
  const sources = message.sources ?? [];
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCitationClick = (n: number) => {
    const src = sources.find((s) => s.n === n);
    if (src) {
      onToggleSource(src);
    } else {
      // If citation n is not in message.sources yet, build minimal fallback
      onToggleSource({
        n,
        documentId: "doc-1",
        fileName: "Indexed Document",
        page: 1,
        snippet: `Passage corresponding to citation [${n}].`,
      });
    }
  };

  return (
    <div
      className={`flex flex-col gap-1.5 ${
        isAssistant ? "items-start" : "items-end"
      } w-full group`}
    >
      {/* Role / Avatar & Header info */}
      <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        {isAssistant ? (
          <>
            <div className="flex h-4 w-4 items-center justify-center rounded bg-indigo-600 text-white">
              <Sparkles className="h-2.5 w-2.5" />
            </div>
            <span className="font-semibold text-foreground">Contexta</span>
            {streaming && (
              <Badge variant="indigo" className="text-[9px] py-0 px-1 animate-pulse">
                Streaming...
              </Badge>
            )}
          </>
        ) : (
          <>
            <span className="font-medium">You</span>
            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-700 text-foreground">
              <User className="h-2.5 w-2.5" />
            </div>
          </>
        )}
      </div>

      {/* Bubble Content */}
      <div
        className={`relative max-w-[90%] md:max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs ${
          isAssistant
            ? "bg-card border border-border/70 text-card-foreground rounded-tl-sm"
            : "bg-indigo-600 text-white rounded-tr-sm"
        }`}
      >
        <MarkdownRenderer
          content={message.content}
          sources={sources}
          onCitationClick={handleCitationClick}
        />

        {/* Copy button for Assistant */}
        {isAssistant && !streaming && message.content && (
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Copy message"
            title="Copy response"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {/* Sources pills below assistant bubble */}
      {isAssistant && sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 px-1">
          <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
            <FileText className="h-3 w-3 text-indigo-500" />
            Sources:
          </span>
          {sources.map((s) => (
            <button
              key={`cite-${message.id}-${s.n}`}
              onClick={() => onToggleSource(s)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border border-indigo-200/80 dark:border-indigo-800/50 rounded-md px-2 py-0.5 transition-colors"
            >
              <span className="font-mono font-semibold">[{s.n}]</span>
              <span className="max-w-[110px] truncate">{s.fileName}</span>
              {s.page != null && (
                <span className="text-[9px] text-muted-foreground">p.{s.page}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Metadata / Time info */}
      <div className="flex items-center gap-2 px-1 text-[10px] text-muted-foreground">
        <span>
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {isAssistant && message.tokensOut > 0 && (
          <span>&bull; {message.tokensOut} tokens</span>
        )}
      </div>
    </div>
  );
}

export type { Source };
