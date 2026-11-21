"use client";

import * as React from "react";
import Link from "next/link";
import { type Message, type Source } from "@contexta/shared";
import { MessageList } from "@/components/message-list";
import { ChatInput } from "@/components/chat-input";
import { SourcePanel } from "@/components/source-panel";
import { useTheme } from "@/lib/theme";
import {
  Sparkles,
  FileText,
  Sun,
  Moon,
  ArrowRight,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const DEMO_SOURCES: Source[] = [
  {
    n: 1,
    documentId: "demo-doc-1",
    fileName: "Sample employee handbook.pdf",
    page: 4,
    snippet:
      "Section 4.2: Eligible employees may carry over up to 5 unused vacation days into the next calendar year. Any unused vacation days above this limit are forfeited without payout.",
  },
  {
    n: 2,
    documentId: "demo-doc-1",
    fileName: "Sample employee handbook.pdf",
    page: 5,
    snippet:
      "Section 4.3: Carryover requests must be submitted through the HR portal at least two weeks before the calendar year-end (December 15 deadline).",
  },
  {
    n: 3,
    documentId: "demo-doc-1",
    fileName: "Sample employee handbook.pdf",
    page: 8,
    snippet:
      "Section 6.1: Travel and business expenses must be submitted within 30 days accompanied by itemized receipts for reimbursement.",
  },
];

const DEMO_REPLIES: Record<string, { content: string; sources: Source[] }> = {
  vacation: {
    content:
      "### Vacation Carryover Policy\n\nAccording to the sample employee handbook, eligible employees may carry over a maximum of **5 unused vacation days** into the following calendar year [1].\n\n#### Key Guidelines:\n- Unused days beyond the 5-day cap cannot be rolled over and are forfeited without payout [1].\n- Formal requests must be submitted via the HR portal at least **two weeks before year-end** (deadline: December 15) [2].\n- Rollover days must be used within the first 6 months of the new year.",
    sources: [DEMO_SOURCES[0], DEMO_SOURCES[1]],
  },
  expense: {
    content:
      "### Expense Reimbursement Rules\n\nAll business-related expenses must comply with Section 6 of the handbook:\n- Claims must be submitted within **30 days** of incurring the expense [3].\n- Itemized receipts are mandatory for all transactions above $25 [3].\n- Standard per diem rates apply to domestic and international travel.",
    sources: [DEMO_SOURCES[2]],
  },
  default: {
    content:
      "Based on the **Sample Employee Handbook**, all full-time team members are entitled to standard benefits, health insurance, and paid time off [1].\n\nYou can click on any citation marker like **[1]** or **[2]** to inspect the exact handbook snippet, file name, and page number in the source drawer.",
    sources: [DEMO_SOURCES[0]],
  },
};

function getDemoReply(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("vacation") || lower.includes("carryover") || lower.includes("pto") || lower.includes("leave")) {
    return DEMO_REPLIES.vacation;
  }
  if (lower.includes("expense") || lower.includes("travel") || lower.includes("reimburse")) {
    return DEMO_REPLIES.expense;
  }
  return DEMO_REPLIES.default;
}

const SAMPLE_PROMPTS = [
  "What are the rules for vacation carryover?",
  "How many unused days can I roll over into the new year?",
  "What is the policy on expense reimbursements?",
];

export default function DemoPage() {
  const { toggle, theme, resolved } = useTheme();

  const [messages, setMessages] = React.useState<Message[]>([
    {
      id: "demo-welcome",
      chatId: "demo",
      role: "assistant",
      content:
        "Welcome to the **Contexta Live Demo**! I've loaded a sample employee handbook. Ask me any policy question to see real-time grounded answers with clickable citations.",
      sources: [],
      tokensIn: 0,
      tokensOut: 0,
      usedFreeBudget: false,
      createdAt: new Date().toISOString(),
    },
  ]);

  const [streamingMessageId, setStreamingMessageId] = React.useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = React.useState(false);
  const [selectedSource, setSelectedSource] = React.useState<Source | null>(null);
  const [disabled, setDisabled] = React.useState(false);

  const handleToggleSource = (source: Source) => {
    setSelectedSource(source);
    setSourcesOpen(true);
  };

  const handleSend = async (content: string) => {
    const userMsg: Message = {
      id: `msg-${Date.now()}-user`,
      chatId: "demo",
      role: "user",
      content,
      sources: [],
      tokensIn: 0,
      tokensOut: 0,
      usedFreeBudget: false,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setDisabled(true);

    const assistantId = `msg-${Date.now()}-assistant`;
    const initialAssistant: Message = {
      id: assistantId,
      chatId: "demo",
      role: "assistant",
      content: "",
      sources: [],
      tokensIn: 240,
      tokensOut: 110,
      usedFreeBudget: false,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, initialAssistant]);
    setStreamingMessageId(assistantId);

    const reply = getDemoReply(content);
    let acc = "";
    const words = reply.content.split(/(\s+)/);

    for (const w of words) {
      await new Promise((r) => setTimeout(r, 20));
      acc += w;
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m)),
      );
    }

    setMessages((prev) =>
      prev.map((m) => (m.id === assistantId ? { ...m, sources: reply.sources } : m)),
    );
    setStreamingMessageId(null);
    setDisabled(false);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Demo Mode Top Bar */}
      <header className="border-b border-border bg-card px-5 py-3 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white font-semibold text-xs shadow-sm">
              C
            </div>
            <span className="font-bold tracking-tight text-sm">Contexta</span>
          </Link>
          <div className="h-4 w-px bg-border hidden sm:block" />
          <Badge variant="indigo" className="text-xs py-0.5 px-2 flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            <span>Interactive Demo</span>
          </Badge>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => toggle(theme === "light" ? "dark" : "light")}
            aria-label="Toggle theme"
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            {resolved === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <Link href="/signup">
            <Button size="sm" className="text-xs h-8 bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs">
              <span>Sign up for full app</span>
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </header>

      {/* Demo Banner */}
      <div className="bg-indigo-50/70 dark:bg-indigo-950/30 border-b border-indigo-200/80 dark:border-indigo-850 px-5 py-2 text-xs text-indigo-800 dark:text-indigo-300 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
          <span>
            Loaded: <strong>Sample employee handbook.pdf</strong> (14 pages, indexed). Chat history in demo mode is ephemeral.
          </span>
        </div>
        <Link href="/login" className="text-[11px] font-semibold underline underline-offset-2 hover:text-indigo-950 dark:hover:text-white">
          Sign in to upload custom files &rarr;
        </Link>
      </div>

      {/* Main Conversation & Right Source Panel */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            <MessageList
              messages={messages}
              streamingMessageId={streamingMessageId}
              onToggleSource={handleToggleSource}
            />

            {/* Prompt Chips */}
            <div className="pt-4 border-t border-border/50">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                <BookOpen className="h-3.5 w-3.5 text-indigo-500" />
                <span>Try asking:</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {SAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSend(prompt)}
                    disabled={disabled}
                    className="text-left text-xs text-muted-foreground hover:text-foreground bg-accent/40 hover:bg-accent border border-border/70 hover:border-indigo-400/50 rounded-lg p-3 transition-colors leading-relaxed"
                  >
                    {prompt} &rarr;
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Collapsible Right Source Panel */}
        <SourcePanel
          open={sourcesOpen}
          source={selectedSource}
          onClose={() => setSourcesOpen(false)}
          onOpen={handleToggleSource}
        />
      </div>

      {/* Chat Input */}
      <div className="shrink-0">
        <ChatInput onSend={handleSend} disabled={disabled} />
      </div>
    </div>
  );
}
