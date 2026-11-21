"use client";

import * as React from "react";
import { type Source } from "@contexta/shared";

interface MarkdownRendererProps {
  content: string;
  sources?: Source[];
  onCitationClick?: (n: number) => void;
}

const escapeHtml = (unsafe: string) =>
  unsafe.replace(/[&<"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c] || c));

export function MarkdownRenderer({
  content,
  sources = [],
  onCitationClick,
}: MarkdownRendererProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  const byNumber = React.useMemo(() => {
    const map: Record<string, Source> = {};
    sources.forEach((s) => {
      map[String(s.n)] = s;
    });
    return map;
  }, [sources]);

  const [html, setHtml] = React.useState("");

  React.useEffect(() => {
    let rendered = escapeHtml(content);

    // Code blocks ```code```
    rendered = rendered.replace(
      /```([\s\S]*?)```/g,
      (_match, code) =>
        `<pre class="bg-neutral-900 text-neutral-100 p-3.5 rounded-lg text-xs font-mono overflow-x-auto my-3 border border-neutral-800"><code>${code.trim()}</code></pre>`,
    );

    // Inline code `code`
    rendered = rendered.replace(
      /`([^`]+)`/g,
      '<code class="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-indigo-600 dark:text-indigo-400">$1</code>',
    );

    // Headings
    rendered = rendered.replace(
      /^#### (.*$)/gm,
      '<h4 class="text-sm font-semibold text-foreground mb-1 mt-3">$1</h4>',
    );
    rendered = rendered.replace(
      /^### (.*$)/gm,
      '<h3 class="text-base font-semibold text-foreground mb-1.5 mt-4">$1</h3>',
    );
    rendered = rendered.replace(
      /^## (.*$)/gm,
      '<h2 class="text-lg font-bold text-foreground mb-2 mt-5">$1</h2>',
    );
    rendered = rendered.replace(
      /^# (.*$)/gm,
      '<h1 class="text-xl font-bold text-foreground mb-2 mt-5">$1</h1>',
    );

    // Bold **text**
    rendered = rendered.replace(
      /\*\*(.+?)\*\*/g,
      '<strong class="font-semibold text-foreground">$1</strong>',
    );
    // Italic *text*
    rendered = rendered.replace(/\*(.+?)\*/g, '<em class="italic">$1</em>');

    // Blockquotes > text
    rendered = rendered.replace(
      /^> (.*$)/gm,
      '<blockquote class="border-l-2 border-indigo-500 pl-3 my-2 text-xs text-muted-foreground italic">$1</blockquote>',
    );

    // Unordered lists
    rendered = rendered.replace(
      /^[-*+] (.*$)/gm,
      '<li class="ml-4 list-disc mb-1 text-sm leading-relaxed">$1</li>',
    );
    rendered = rendered.replace(/(<li class="ml-4 list-disc.*?<\/li>)+/gms, (match) => {
      return `<ul class="my-2 space-y-0.5">${match}</ul>`;
    });

    // Ordered lists
    rendered = rendered.replace(
      /^\d+\. (.*$)/gm,
      '<li class="ml-4 list-decimal mb-1 text-sm leading-relaxed">$1</li>',
    );
    rendered = rendered.replace(/(<li class="ml-4 list-decimal.*?<\/li>)+/gms, (match) => {
      return `<ol class="my-2 space-y-0.5 list-decimal">${match}</ol>`;
    });

    // Citation markers [n] -> clickable interactive citation pill
    rendered = rendered.replace(/\[(\d+)\]/g, (_match, n) => {
      return `<button type="button" class="cite inline-flex items-center justify-center font-mono text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800/60 px-1.5 py-0.2 mx-0.5 rounded cursor-pointer transition-colors shadow-xs" data-citation="${n}" title="Open citation [${n}]">[${n}]</button>`;
    });

    // Paragraph line breaks (preserve paragraph spacing)
    rendered = rendered.replace(/\n\n/g, '<div class="h-2.5"></div>');
    rendered = rendered.replace(/\n/g, "<br />");

    setHtml(rendered);
  }, [content, sources, byNumber]);

  // Click delegation for citations
  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest("[data-citation]");
    if (target) {
      e.preventDefault();
      e.stopPropagation();
      const n = parseInt(target.getAttribute("data-citation") || "0", 10);
      if (n > 0 && onCitationClick) {
        onCitationClick(n);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      className="prose-content text-sm leading-relaxed break-words"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
