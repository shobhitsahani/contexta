"use client";

import Link from "next/link";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  BookOpen,
  FileText,
  ShieldCheck,
  Sparkles,
  MessageCircle,
  Sun,
  Moon,
  UploadCloud,
  Lock,
  ArrowRight,
  Database,
} from "lucide-react";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "/demo", label: "Live Demo" },
];

export default function LandingPage() {
  const { theme, toggle, resolved } = useTheme();

  return (
    <div className="relative min-h-screen flex flex-col bg-background text-foreground">
      {/* Navigation Bar */}
      <nav className="sticky top-0 z-50 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white font-semibold text-sm shadow-sm">
              C
            </div>
            <span className="font-bold tracking-tight text-base">Contexta</span>
          </Link>

          <div className="flex items-center gap-6 text-sm">
            <div className="hidden md:flex items-center gap-6 text-sm">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-muted-foreground hover:text-foreground font-medium transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => toggle(theme === "light" ? "dark" : "light")}
                aria-label="Toggle theme"
                className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                {resolved === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>

              <div className="flex items-center gap-2">
                <Link href="/login">
                  <Button variant="ghost" size="sm" className="text-xs h-8">
                    Sign in
                  </Button>
                </Link>
                <Link href="/signup">
                  <Button size="sm" className="text-xs h-8 bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs">
                    Get started
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="relative px-6 py-20 md:py-32 text-center overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-indigo-50/50 dark:bg-indigo-950/20 blur-[100px] rounded-full [mask:radial-gradient(ellipse_60%_50%_at_50%_30%,#000_70%,transparent)]" />
          <div className="max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/60 text-xs font-medium text-indigo-700 dark:text-indigo-300 mb-6 shadow-xs">
              <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
              <span>Free to try &bull; Bring your own key after token allowance</span>
            </div>

            <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight mb-6 text-foreground">
              AI that understands <span className="text-indigo-600 dark:text-indigo-400">your context.</span>
            </h1>

            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              Upload your documents and get grounded answers in real time. Contexta extracts relevant passages, embeds them into pgvector, and streams responses with verifiable citations.
            </p>

            <div className="flex flex-col sm:flex-row gap-3.5 justify-center items-center">
              <Link href="/dashboard" className="w-full sm:w-auto">
                <Button size="lg" className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm text-sm h-11 px-6">
                  <span>Start chatting</span>
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/demo" className="w-full sm:w-auto">
                <Button variant="outline" size="lg" className="w-full sm:w-auto text-sm h-11 px-6 border-border/80">
                  Try interactive demo
                </Button>
              </Link>
            </div>

            {/* Quick stats / reassurance */}
            <div className="mt-12 pt-8 border-t border-border/60 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-xl font-bold text-foreground">PDF, DOCX, TXT</div>
                <div className="text-xs text-muted-foreground mt-0.5">Direct parsing</div>
              </div>
              <div>
                <div className="text-xl font-bold text-foreground">Clickable [n]</div>
                <div className="text-xs text-muted-foreground mt-0.5">Verified citations</div>
              </div>
              <div>
                <div className="text-xl font-bold text-foreground">50k Tokens</div>
                <div className="text-xs text-muted-foreground mt-0.5">Free allowance</div>
              </div>
              <div>
                <div className="text-xl font-bold text-foreground">AES-256-GCM</div>
                <div className="text-xs text-muted-foreground mt-0.5">Encrypted BYOK</div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="px-6 py-20 border-y border-border/60 bg-accent/10">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16 max-w-2xl mx-auto">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3">
                Built around your documents
              </h2>
              <p className="text-sm text-muted-foreground">
                Everything required to transform scattered documents into actionable intelligence.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                {
                  icon: UploadCloud,
                  title: "Drag-and-drop uploads",
                  desc: "Supports PDF, DOCX, and TXT files. Watch each document move live through queued, parsing, embedding, and ready states.",
                },
                {
                  icon: MessageCircle,
                  title: "Single or multi-doc chat",
                  desc: "Scope your conversation to specific documents or query your entire library simultaneously with scoped vector filtering.",
                },
                {
                  icon: BookOpen,
                  title: "Clickable citations",
                  desc: "Every answer cites exact passages. Clicking [n] opens the source drawer showing original file name, page number, and snippet.",
                },
                {
                  icon: Sparkles,
                  title: "Streaming AI responses",
                  desc: "Tokens stream live via Server-Sent Events with rich Markdown formatting, lists, code blocks, and copy actions.",
                },
                {
                  icon: FileText,
                  title: "Document outlines & summaries",
                  desc: "Inspect extracted section outlines and generate executive summaries or section-by-section syntheses in seconds.",
                },
                {
                  icon: ShieldCheck,
                  title: "Bring your own key (BYOK)",
                  desc: "Choose between Google Gemini, OpenAI, or Anthropic. All keys are encrypted at rest with AES-256-GCM and never logged.",
                },
              ].map((f) => {
                const Icon = f.icon;
                return (
                  <Card key={f.title} className="hover:border-indigo-400/50 transition-all shadow-xs border-border/70 bg-card">
                    <CardHeader className="pb-2 pt-5 px-5">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 mb-3 shadow-xs">
                        <Icon className="h-5 w-5" />
                      </div>
                      <CardTitle className="text-base font-semibold">{f.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-5 pb-5 text-xs text-muted-foreground leading-relaxed">
                      {f.desc}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="px-6 py-20">
          <div className="max-w-6xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-6">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-600">
                  <Database className="h-3.5 w-3.5" />
                  <span>Pipeline Architecture</span>
                </div>
                <h2 className="text-3xl font-bold tracking-tight text-foreground">
                  Grounded retrieval from upload to answer
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Unlike generic chatbots, Contexta strictly grounds its answers in verified document chunks. Chunks are treated as data, not instructions, guarding against prompt injection.
                </p>

                <div className="space-y-4 pt-2">
                  {[
                    {
                      step: "01",
                      title: "Chunk & Embed",
                      desc: "Documents are split into heading-aware passages of ~600 tokens and embedded into 768-dimensional pgvector representations.",
                    },
                    {
                      step: "02",
                      title: "Vector Search",
                      desc: "Your query is embedded and compared using HNSW cosine similarity across your authorized document scope.",
                    },
                    {
                      step: "03",
                      title: "Streamed Generation with Citations",
                      desc: "The top relevant passages are supplied to the LLM to stream a verified response with clickable [n] citations.",
                    },
                  ].map((s) => (
                    <div key={s.step} className="flex gap-4 p-3 rounded-xl border border-border/60 bg-accent/20">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white font-mono text-xs font-semibold shrink-0">
                        {s.step}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-foreground">{s.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{s.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Visual Architecture Representation */}
              <div className="rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-border text-xs text-muted-foreground font-mono">
                  <span>rag_pipeline_flow.ts</span>
                  <Badge variant="indigo" className="text-[10px] py-0 px-1.5">
                    Live
                  </Badge>
                </div>
                <div className="font-mono text-xs space-y-2 bg-neutral-900 text-neutral-100 p-4 rounded-xl overflow-x-auto">
                  <div className="text-indigo-400">{`// 1. Ingestion`}</div>
                  <div>{`const chunks = chunk(document, { targetTokens: 600 });`}</div>
                  <div>{`const embeddings = await embed(chunks.map(c => c.text));`}</div>
                  <div className="pt-2 text-indigo-400">{`// 2. Scoped Query`}</div>
                  <div>{`const hits = await searchVectors(query, { chatScope, k: 8 });`}</div>
                  <div className="pt-2 text-indigo-400">{`// 3. Grounded Stream`}</div>
                  <div>{`for await (const chunk of streamAnswer(query, hits)) {`}</div>
                  <div className="pl-4">{`yield { delta: chunk.text, citations: chunk.citations };`}</div>
                  <div>{`}`}</div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                  <Lock className="h-3.5 w-3.5 text-indigo-600" />
                  <span>Stateless API &bull; End-to-end user isolation &bull; Free tier ready</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Demo Call To Action */}
        <section className="px-6 py-20 bg-indigo-600 text-white">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <h2 className="text-3xl font-bold tracking-tight">
              Test Contexta immediately in demo mode
            </h2>
            <p className="text-indigo-100 text-sm max-w-xl mx-auto leading-relaxed">
              No account or API key required. Chat with our sample corporate handbook to experience real-time streaming and citation tracking firsthand.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center pt-2">
              <Link href="/demo">
                <Button size="lg" className="bg-white text-indigo-700 hover:bg-neutral-100 font-semibold shadow-md text-xs h-10 px-6">
                  Launch Demo Mode
                </Button>
              </Link>
              <Link href="/signup">
                <Button variant="outline" size="lg" className="bg-transparent border-white/60 text-white hover:bg-white/10 text-xs h-10 px-6">
                  Create free account
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/70 bg-card px-6 py-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-indigo-600 text-white font-semibold text-[10px]">
              C
            </div>
            <span className="font-semibold text-foreground">Contexta</span>
            <span>&bull; Intelligent Knowledge Assistant</span>
          </div>

          <div>
            Built with Next.js, Express, pgvector, and Tailwind CSS.
          </div>
        </div>
      </footer>
    </div>
  );
}
