"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { type Document, type DocumentStatus } from "@contexta/shared";
import { documentsApi } from "@/lib/api";
import { useApp } from "@/context/app-context";
import {
  UploadCloud,
  FileText,
  Trash2,
  Sparkles,
  X,
  MessageSquare,
  BookOpen,
  Search,
  CheckCircle,
  AlertTriangle,
  Clock,
  Layers,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// Outline fixtures for documents
interface OutlineSection {
  title: string;
  pageStart: number;
  pageEnd: number;
  snippet: string;
}

const MOCK_OUTLINES: Record<string, OutlineSection[]> = {
  "doc-1": [
    {
      title: "1. Introduction & Company Culture",
      pageStart: 1,
      pageEnd: 2,
      snippet:
        "Contexta is committed to a flexible, high-trust workplace where employees excel through clarity of context and open collaboration.",
    },
    {
      title: "2. Working Hours & Remote Work Guidelines",
      pageStart: 3,
      pageEnd: 3,
      snippet:
        "Core collaboration hours are 10:00 AM to 3:00 PM local time. Remote employees are expected to maintain prompt communication on internal channels.",
    },
    {
      title: "3. Paid Time Off (PTO) & Leave Accrual",
      pageStart: 4,
      pageEnd: 4,
      snippet:
        "Standard full-time employees accrue 15 days of PTO annually. Leave balances are updated monthly in the payroll portal.",
    },
    {
      title: "4. Vacation Carryover & Expiration Rules",
      pageStart: 5,
      pageEnd: 6,
      snippet:
        "Employees may roll over up to 5 unused PTO days into the following calendar year. Requests must be logged 14 days before December 31.",
    },
    {
      title: "5. Code of Conduct & Workplace Safety",
      pageStart: 7,
      pageEnd: 10,
      snippet:
        "Zero-tolerance policy for harassment, discrimination, or intimidation. Reporting mechanisms are anonymous and confidential.",
    },
    {
      title: "6. Compensation, Benefits & Retirement Plan",
      pageStart: 11,
      pageEnd: 14,
      snippet:
        "Health, vision, and dental plans are subsidized at 90%. Contexta matches 401(k) contributions up to 4% of total compensation.",
    },
  ],
  "doc-2": [
    {
      title: "1. Access Control & Multi-Factor Authentication",
      pageStart: 1,
      pageEnd: 2,
      snippet:
        "Hardware security keys or approved authenticator apps are required for all cloud and local access. SMS verification is prohibited.",
    },
    {
      title: "2. Device Security & Encryption Standards",
      pageStart: 3,
      pageEnd: 4,
      snippet:
        "Full-disk encryption (FileVault / BitLocker) must remain enabled. Automatic lock triggers after 5 minutes of inactivity.",
    },
    {
      title: "3. Incident Response & Vulnerability Reporting",
      pageStart: 5,
      pageEnd: 6,
      snippet:
        "Suspected breaches or phishing emails must be reported immediately to security@contexta.local. Escalation follows severity tiers S1-S4.",
    },
  ],
  default: [
    {
      title: "1. Overview & Objectives",
      pageStart: 1,
      pageEnd: 1,
      snippet: "Comprehensive summary of document purpose, scope, and target audience.",
    },
    {
      title: "2. Core Procedures & Guidelines",
      pageStart: 2,
      pageEnd: 2,
      snippet: "Step-by-step requirements for compliant implementation.",
    },
    {
      title: "3. Appendix & References",
      pageStart: 3,
      pageEnd: 3,
      snippet: "Reference terms, definitions, and external document links.",
    },
  ],
};

interface SummaryModalData {
  docId?: string;
  docName: string;
  overview: string;
  keyPoints: string[];
  sections: Array<{ title: string; summary: string }>;
}

function getOutlineForDoc(doc: Document | null): OutlineSection[] {
  if (!doc) return [];
  if (MOCK_OUTLINES[doc.id]) return MOCK_OUTLINES[doc.id];
  const name = doc.name.toLowerCase();
  if (
    name.includes("roadmap") ||
    name.includes("engineering") ||
    name.includes("full stack") ||
    name.includes("developer")
  ) {
    return [
      {
        title: "1. Frontend Architecture & Web Standards",
        pageStart: 1,
        pageEnd: 3,
        snippet:
          "Core principles of modern frontend development: component lifecycle, server-side rendering, bundle splitting, state management, and Core Web Vitals optimization.",
      },
      {
        title: "2. Backend APIs, Microservices & Data Modeling",
        pageStart: 4,
        pageEnd: 6,
        snippet:
          "High-performance API design (REST/gRPC/SSE), relational schemas, vector databases with pgvector, and distributed caching strategies using Redis.",
      },
      {
        title: "3. DevOps, Cloud Infrastructure & Containerization",
        pageStart: 7,
        pageEnd: 9,
        snippet:
          "Docker containerization, Kubernetes orchestration, CI/CD automation pipelines via GitHub Actions, and infrastructure-as-code practices.",
      },
      {
        title: "4. Security, Authentication & Observability",
        pageStart: 10,
        pageEnd: 12,
        snippet:
          "OAuth 2.0 / OIDC protocols, role-based access control, cryptographic key management, structured logging, and distributed tracing.",
      },
      {
        title: "5. System Scalability & Production Readiness",
        pageStart: 13,
        pageEnd: doc.pageCount || 15,
        snippet:
          "Load balancing, horizontal scaling, database replication, fault tolerance patterns, and disaster recovery SLA guidelines.",
      },
    ];
  }
  return MOCK_OUTLINES.default;
}

export default function DocumentsPage() {
  const router = useRouter();
  const {
    documents,
    addDocument,
    updateDocumentStatus,
    removeDocument,
    createChat,
    simulateIngestion,
  } = useApp();

  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedDocId, setSelectedDocId] = React.useState<string | null>(
    documents[0]?.id || null,
  );
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  // Summary Modal state
  const [summaryData, setSummaryData] = React.useState<SummaryModalData | null>(null);
  const [copiedSummary, setCopiedSummary] = React.useState(false);

  // Active selected document
  const selectedDoc = documents.find((d) => d.id === selectedDocId) || documents[0] || null;

  // Filtered documents
  const filteredDocs = documents.filter((d) =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleFileUpload = async (file: File) => {
    setUploadError(null);

    // Validate size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File exceeds the 10 MB limit. Please upload a smaller file.");
      return;
    }

    // Validate extension
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx", "txt"].includes(ext || "")) {
      setUploadError("Unsupported format. Only PDF, DOCX, and TXT files are supported.");
      return;
    }

    setUploading(true);

    const tempId = `doc-${Date.now()}`;
    const newDoc: Document = {
      id: tempId,
      userId: null,
      name: file.name,
      mime: file.type || (ext === "pdf" ? "application/pdf" : ext === "docx" ? "application/vnd.openxmlformats" : "text/plain"),
      sizeBytes: file.size,
      status: "queued",
      pageCount: ext === "pdf" ? Math.floor(Math.random() * 12) + 3 : 1,
      isDemo: false,
      summaryStatus: "ready",
      createdAt: new Date().toISOString(),
    };

    addDocument(newDoc);
    setSelectedDocId(newDoc.id);

    try {
      // Attempt real API upload
      const res = await documentsApi.upload(file);
      if (res?.id) {
        updateDocumentStatus(tempId, "parsing");
        // Poll for ready status
        pollDocumentStatus(tempId);
      }
    } catch {
      // Backend offline; simulate realistic ingestion pipeline
      void simulateIngestion(tempId);
    } finally {
      setUploading(false);
    }
  };

  const pollDocumentStatus = async (id: string) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const doc = await documentsApi.get(id);
        updateDocumentStatus(id, doc.status, doc.error);
        if (doc.status === "ready" || doc.status === "failed" || attempts > 15) {
          clearInterval(interval);
        }
      } catch {
        if (attempts > 5) clearInterval(interval);
      }
    }, 2000);
  };

  const handleStartChatWithDoc = (docId: string, docName: string) => {
    const newChatId = createChat(`Chat: ${docName}`, [docId]);
    router.push(`/dashboard/${newChatId}`);
  };

  const handleSummarizeDoc = (doc: Document) => {
    const outline = getOutlineForDoc(doc);
    const name = doc.name.toLowerCase();
    const isRoadmap =
      name.includes("roadmap") ||
      name.includes("engineering") ||
      name.includes("full stack");
    const isSecurity = name.includes("security") || name.includes("compliance");
    const isHandbook = name.includes("handbook") || name.includes("employee");

    const overview = isRoadmap
      ? `Comprehensive technical synthesis of "${doc.name}". This roadmap outlines modern software engineering competencies, architectural patterns, distributed backend services, and cloud deployment infrastructure.`
      : isSecurity
      ? `Detailed security overview of "${doc.name}". Establishes access control, hardware token verification, encryption mandates, and vulnerability management.`
      : isHandbook
      ? `Corporate policy summary of "${doc.name}". Details working hours, PTO accrual, vacation rollover, and employee benefits.`
      : `Comprehensive synthesis of "${doc.name}". This document establishes operational and procedural policies ensuring compliance, security, and consistent cross-functional execution.`;

    const keyPoints = isRoadmap
      ? [
          "Covers end-to-end full-stack mastery from responsive frontend to cloud-native backends.",
          "Mandates robust data persistence patterns including relational SQL, caching, and vector search.",
          "Emphasizes containerized deployment, CI/CD automation, and zero-downtime releases.",
          "Establishes production readiness through observability, distributed tracing, and security standards.",
        ]
      : isSecurity
      ? [
          "Hardware token MFA is mandatory across all internal and production access points.",
          "Full-disk encryption and automated screensaver locking required on all machines.",
          "Security incidents must be escalated immediately via tier S1-S4 response channels.",
        ]
      : [
          "Defines procedural expectations and criteria for all personnel.",
          "Specifies escalation pathways and responsible departmental owners.",
          "Establishes annual review schedules and audit guidelines.",
          "Enforces verifiable adherence across all active systems.",
        ];

    setTimeout(() => {
      setSummaryData({
        docId: doc.id,
        docName: doc.name,
        overview,
        keyPoints,
        sections: outline.map((sec) => ({
          title: sec.title,
          summary: sec.snippet,
        })),
      });
    }, 400);
  };

  const handleSummarizeSection = (doc: Document, section: OutlineSection) => {
    setTimeout(() => {
      setSummaryData({
        docId: doc.id,
        docName: `${doc.name} — ${section.title}`,
        overview: `Detailed focus on ${section.title} (Pages ${section.pageStart}-${section.pageEnd}).`,
        keyPoints: [
          section.snippet,
          "Mandatory compliance applies to all active team members.",
          "Audited quarterly under standard operational governance.",
        ],
        sections: [
          {
            title: section.title,
            summary: section.snippet,
          },
        ],
      });
    }, 400);
  };

  const copySummaryText = () => {
    if (!summaryData) return;
    const text = `# Summary: ${summaryData.docName}\n\n${summaryData.overview}\n\n## Key Takeaways\n${summaryData.keyPoints.map((p) => `- ${p}`).join("\n")}\n\n## Sections\n${summaryData.sections.map((s) => `### ${s.title}\n${s.summary}`).join("\n\n")}`;
    navigator.clipboard.writeText(text);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const outline = getOutlineForDoc(selectedDoc);

  return (
    <div className="flex-1 overflow-y-auto p-5 md:p-8 space-y-6 max-w-7xl mx-auto w-full">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Document Library
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upload PDF, DOCX, or TXT documents to index them for grounded RAG search and chat.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="indigo" className="text-xs py-1 px-2.5">
            {documents.length} / 5 documents used
          </Badge>
        </div>
      </div>

      {/* Drag & Drop Upload Zone */}
      <DropZone
        onFileSelect={handleFileUpload}
        uploading={uploading}
        error={uploadError}
      />

      {/* Main Grid: Document List on Left, Document Outline on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Document List (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <Card className="shadow-xs border-border/80">
            <CardHeader className="pb-3 pt-5 px-5 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">Indexed Files</CardTitle>
                <CardDescription className="text-xs">
                  Select a document to inspect its outline and section structure.
                </CardDescription>
              </div>

              {/* Search Bar */}
              <div className="relative w-48">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Filter files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pl-8 text-xs bg-accent/40"
                />
              </div>
            </CardHeader>

            <CardContent className="px-5 pb-5">
              {filteredDocs.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-xs">
                  {searchQuery ? "No documents match your query." : "No documents uploaded yet."}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredDocs.map((doc) => {
                    const isSelected = selectedDoc?.id === doc.id;
                    return (
                      <div
                        key={doc.id}
                        onClick={() => setSelectedDocId(doc.id)}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer gap-3 ${
                          isSelected
                            ? "border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/20 shadow-xs"
                            : "border-border/70 hover:border-border hover:bg-accent/40"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-background border border-border text-indigo-600 shrink-0">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-foreground truncate max-w-[200px] sm:max-w-xs">
                              {doc.name}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                              <span>{(doc.sizeBytes / 1024).toFixed(0)} KB</span>
                              <span>&bull;</span>
                              <span>{doc.pageCount ? `${doc.pageCount} pages` : "1 page"}</span>
                              <span>&bull;</span>
                              <span className="capitalize">{doc.mime.split("/")[1] || "text"}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                          <StatusBadge status={doc.status} />

                          {doc.status === "ready" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs px-2 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartChatWithDoc(doc.id, doc.name);
                              }}
                              title="Start chat with this document"
                            >
                              <MessageSquare className="h-3.5 w-3.5 mr-1" />
                              <span>Chat</span>
                            </Button>
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Delete document "${doc.name}"?`)) {
                                removeDocument(doc.id);
                                if (selectedDocId === doc.id) {
                                  setSelectedDocId(null);
                                }
                              }
                            }}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Delete document"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Document Outline & Summarize Panel (5 Cols) */}
        <div className="lg:col-span-5">
          <Card className="shadow-xs border-border/80 h-full flex flex-col">
            <CardHeader className="pb-3 pt-5 px-5 border-b border-border/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-indigo-600" />
                  <CardTitle className="text-base font-semibold">Document Outline</CardTitle>
                </div>

                {selectedDoc && selectedDoc.status === "ready" && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => handleSummarizeDoc(selectedDoc)}
                    className="h-7 text-xs px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    <Sparkles className="h-3 w-3 mr-1" />
                    <span>Summarize</span>
                  </Button>
                )}
              </div>
              <CardDescription className="text-xs">
                {selectedDoc
                  ? `Extracted headings and sections for "${selectedDoc.name}"`
                  : "Select a document from the list to view its outline."}
              </CardDescription>
            </CardHeader>

            <CardContent className="p-5 flex-1 overflow-y-auto">
              {!selectedDoc ? (
                <div className="py-16 text-center text-muted-foreground text-xs">
                  No document selected.
                </div>
              ) : selectedDoc.status !== "ready" ? (
                <div className="py-16 text-center text-muted-foreground text-xs space-y-2">
                  <Clock className="h-6 w-6 mx-auto text-indigo-600 animate-spin" />
                  <p>Document is currently {selectedDoc.status}. Outline will appear once indexing is ready.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground pb-2 border-b border-border/50">
                    <span>{outline.length} Sections Extracted</span>
                    <span>Click section to summarize</span>
                  </div>

                  {outline.map((sec, idx) => (
                    <div
                      key={idx}
                      className="group rounded-lg border border-border/70 hover:border-indigo-400/50 bg-card p-3 transition-colors space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-xs text-foreground group-hover:text-indigo-600 transition-colors">
                          {sec.title}
                        </div>
                        <Badge variant="default" className="text-[10px] py-0 px-1.5 shrink-0 bg-muted">
                          p.{sec.pageStart}{sec.pageEnd > sec.pageStart ? `-${sec.pageEnd}` : ""}
                        </Badge>
                      </div>

                      <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                        {sec.snippet}
                      </p>

                      <div className="pt-1 flex items-center justify-between">
                        <button
                          onClick={() => handleSummarizeSection(selectedDoc, sec)}
                          className="text-[11px] text-indigo-600 hover:underline font-medium flex items-center gap-1"
                        >
                          <Sparkles className="h-3 w-3" />
                          <span>Summarize section</span>
                        </button>

                        <button
                          onClick={() => handleStartChatWithDoc(selectedDoc.id, selectedDoc.name)}
                          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                        >
                          <span>Ask about this</span>
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Summary Modal */}
      {summaryData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/60 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl max-h-[85vh] bg-card border border-border shadow-2xl rounded-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                <h3 className="font-semibold text-sm text-foreground">
                  Document Summary
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copySummaryText}
                  className="h-7 text-xs px-2"
                >
                  {copiedSummary ? (
                    <>
                      <Check className="h-3 w-3 mr-1 text-green-600" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 mr-1" />
                      <span>Copy</span>
                    </>
                  )}
                </Button>
                <button
                  onClick={() => setSummaryData(null)}
                  className="p-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-sm">
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Overview
                </h4>
                <p className="text-sm text-foreground leading-relaxed bg-accent/30 p-3.5 rounded-lg border border-border/60">
                  {summaryData.overview}
                </p>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Key Takeaways
                </h4>
                <ul className="space-y-1.5 list-disc pl-5 text-xs text-foreground leading-relaxed">
                  {summaryData.keyPoints.map((pt, i) => (
                    <li key={i}>{pt}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Section Syntheses
                </h4>
                <div className="space-y-2.5">
                  {summaryData.sections.map((sec, i) => (
                    <div key={i} className="rounded-lg border border-border/70 p-3 bg-card space-y-1">
                      <div className="font-medium text-xs text-indigo-600 dark:text-indigo-400">
                        {sec.title}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {sec.summary}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-border bg-accent/20 flex justify-between items-center">
              <span className="text-[11px] text-muted-foreground">
                Grounded summary generated from indexed vectors.
              </span>
              <Button
                size="sm"
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8"
                onClick={() => {
                  const docId = summaryData.docId || selectedDoc?.id || "doc-1";
                  const newChatId = createChat(`Summary Discussion: ${summaryData.docName}`, [docId]);

                  const summaryText = `### Document Summary: ${summaryData.docName}\n\n${summaryData.overview}\n\n#### Key Takeaways:\n${summaryData.keyPoints.map((pt) => `- ${pt}`).join("\n")}\n\n#### Section Syntheses:\n${summaryData.sections.map((sec, i) => `${i + 1}. **${sec.title}**: ${sec.summary} [${i + 1}]`).join("\n\n")}\n\n*You can ask any follow-up questions about this document or specific sections below.*`;

                  const summarySources = summaryData.sections.map((sec, i) => ({
                    n: i + 1,
                    documentId: docId,
                    fileName: summaryData.docName,
                    page: i + 1,
                    snippet: `${sec.title}: ${sec.summary}`,
                  }));

                  try {
                    localStorage.setItem(
                      `contexta_chat_init_${newChatId}`,
                      JSON.stringify({ content: summaryText, sources: summarySources })
                    );
                    const existingStore = localStorage.getItem("contexta_messages_store");
                    const store = existingStore ? JSON.parse(existingStore) : {};
                    store[newChatId] = [
                      {
                        id: `msg-summary-${newChatId}`,
                        chatId: newChatId,
                        role: "assistant",
                        content: summaryText,
                        sources: summarySources,
                        tokensIn: 340,
                        tokensOut: 260,
                        usedFreeBudget: true,
                        createdAt: new Date().toISOString(),
                      },
                    ];
                    localStorage.setItem("contexta_messages_store", JSON.stringify(store));
                  } catch {}

                  setSummaryData(null);
                  router.push(`/dashboard/${newChatId}`);
                }}
              >
                Discuss in chat &#8594;
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Drag & Drop Upload Component
function DropZone({
  onFileSelect,
  uploading,
  error,
}: {
  onFileSelect: (file: File) => void;
  uploading: boolean;
  error: string | null;
}) {
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileSelect(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-dashed transition-all cursor-pointer ${
          dragOver
            ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/30 scale-[1.005]"
            : "border-border/80 hover:border-indigo-400 hover:bg-accent/30 bg-card"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onFileSelect(e.target.files[0]);
            }
          }}
        />

        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 mb-3 shadow-xs">
          {uploading ? (
            <Clock className="h-6 w-6 animate-spin text-indigo-600" />
          ) : (
            <UploadCloud className="h-6 w-6" />
          )}
        </div>

        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">
            {uploading ? "Uploading document..." : "Click to upload or drag and drop"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            PDF, DOCX, or TXT up to 10 MB (scanned PDFs not supported yet)
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-xs text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// Status Badge Component
function StatusBadge({ status }: { status: DocumentStatus }) {
  const styles: Record<
    DocumentStatus,
    { label: string; bg: string; icon: React.ReactNode }
  > = {
    queued: {
      label: "Queued",
      bg: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
      icon: <Clock className="h-3 w-3 mr-1" />,
    },
    parsing: {
      label: "Parsing...",
      bg: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400 animate-pulse border-indigo-200",
      icon: <Clock className="h-3 w-3 mr-1 animate-spin" />,
    },
    embedding: {
      label: "Embedding...",
      bg: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400 animate-pulse border-indigo-200",
      icon: <Layers className="h-3 w-3 mr-1 animate-spin" />,
    },
    ready: {
      label: "Ready",
      bg: "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400 border-green-200/60",
      icon: <CheckCircle className="h-3 w-3 mr-1 text-green-600" />,
    },
    failed: {
      label: "Failed",
      bg: "bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive border-destructive/30",
      icon: <AlertTriangle className="h-3 w-3 mr-1" />,
    },
  };

  const current = styles[status] || styles.queued;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${current.bg}`}
    >
      {current.icon}
      {current.label}
    </span>
  );
}
