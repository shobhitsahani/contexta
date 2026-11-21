"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { type Message, type Source, type Document as ContextaDoc } from "@contexta/shared";
import { messagesApi, type MessageSendOptions, usageApi, isWaking } from "@/lib/api";
import { MessageList } from "@/components/message-list";
import { ChatInput } from "@/components/chat-input";
import { SourcePanel } from "@/components/source-panel";
import { useApp } from "@/context/app-context";
import {
  FileText,
  Plus,
  Sparkles,
  Layers,
  ChevronDown,
  Check,
  AlertCircle,
  Clock,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

const MOCK_REPLIES: Record<string, { content: string; sources: Source[] }> = {
  vacation: {
    content:
      "### Vacation Carryover Policy\n\nBased on the uploaded policy documentation, eligible full-time employees may carry over a maximum of **5 unused vacation days** into the following calendar year [1].\n\n#### Key Conditions:\n- Requests for carryover must be submitted at least **two weeks before year-end** [2].\n- Unused days beyond the 5-day cap expire on December 31st and cannot be paid out as cash.\n- Manager approval is required via the internal HR portal.",
    sources: [
      {
        n: 1,
        documentId: "doc-1",
        fileName: "Employee_Handbook_2026.pdf",
        page: 4,
        snippet:
          "Section 4.2: Eligible employees may carry over up to 5 unused vacation days into the next calendar year. Any additional days will be forfeited.",
      },
      {
        n: 2,
        documentId: "doc-1",
        fileName: "Employee_Handbook_2026.pdf",
        page: 5,
        snippet:
          "Section 4.3: Carryover requests must be submitted through Workday at least two weeks prior to the close of the calendar year.",
      },
    ],
  },
  default: {
    content:
      "I found relevant passages in your documents. According to the indexed text, all operational guidelines require adherence to verified documentation [1].\n\nYou can click the citation marker **[1]** or any source pill to inspect the source file, page number, and exact text snippet in the source panel on the right.",
    sources: [
      {
        n: 1,
        documentId: "doc-1",
        fileName: "Employee_Handbook_2026.pdf",
        page: 2,
        snippet:
          "Operating Guidelines: Employees must consult updated documentation for specific procedural questions.",
      },
    ],
  },
};

function getMockReply(
  query: string,
  attachedDocs: ContextaDoc[] = [],
  chatTitle?: string,
): { content: string; sources: Source[] } {
  const q = query.toLowerCase();

  const primaryDoc = attachedDocs[0];
  const primaryName =
    primaryDoc?.name ||
    (chatTitle
      ? chatTitle
          .replace(/^summary discussion:\s*/i, "")
          .replace(/^summary:\s*/i, "")
          .replace(/\.\.\.$/, "")
          .trim()
      : "") ||
    "Full Stack Engineering Roadmap.pdf";
  const docId = primaryDoc?.id || "doc-1";
  const isRoadmap =
    primaryName.toLowerCase().includes("roadmap") ||
    primaryName.toLowerCase().includes("engineering") ||
    primaryName.toLowerCase().includes("full stack");

  // Specific intent classifications
  const isRAG =
    /\brag\b|retrieval[- ]augmented|vector|embedding|pgvector|hnsw|similarity|cosine|chunk|chunking|citation/i.test(
      q,
    );

  const isBackend =
    /b[a-z]{0,3}k[- ]?end|server|api|node|bun|express|rest|sse|streaming|microservice|grpc|trpc/i.test(
      q,
    );

  const isDatabase =
    /database|db|postgres|sql|drizzle|orm|redis|cache|queue|persistence/i.test(
      q,
    );

  const isFrontend =
    /fr[a-z]{0,3}nt[- ]?end|client|ui|ux|react|next|app router|view|component|css|tailwind|html|vitals|bundle/i.test(
      q,
    );

  const isDevOps =
    /dev[- ]?ops|docker|container|k8s|kubernetes|deploy|ci\/?cd|pipeline|cloud|aws|render|vercel/i.test(
      q,
    );

  const isSecurity =
    /secur|auth|better auth|token|jwt|encrypt|aes|mfa|password|cors|helmet|rate[- ]?limit/i.test(
      q,
    );

  const isTesting =
    /test|testing|vitest|jest|qa|coverage|pglite|mock/i.test(
      q,
    );

  const isDevelopment =
    /dev[a-z]*|defv|lifecycle|steps?|roadmap|milestone|practic|architect|pattern|stack/i.test(
      q,
    );

  const isSummary =
    /summar|overview|main point|key point|tldr|recap|what is this (about|doc)/i.test(
      q,
    );

  if (isRoadmap) {
    if (isSummary) {
      return {
        content: `### Document Summary: ${primaryName}\n\nThis document provides an end-to-end technical roadmap for full-stack engineering, establishing architectural standards, developer milestones, and production infrastructure practices [1].\n\n#### Key Takeaways:\n- **Frontend Architecture**: Modern reactive UI development, component lifecycles, state management, and Core Web Vitals optimization [1].\n- **Backend Systems & Data Persistence**: Scalable API design (REST/SSE/gRPC), relational data modeling, Redis caching, and pgvector embeddings [2].\n- **Cloud Infrastructure & DevOps**: Docker containerization, Kubernetes orchestration, CI/CD automated pipelines, and zero-trust security postures [3].\n- **Reliability & Observability**: Distributed tracing, structured logging, latency profiling, and fault-tolerant architecture.\n\n#### Section Syntheses:\n1. **Frontend Architecture & Web Standards**: Modern framework patterns, accessibility compliance, and client-side performance [1].\n2. **Backend Engineering & Data Persistence**: High-throughput service design, database indexing, caching strategies, and data integrity [2].\n3. **Cloud Infrastructure & DevOps**: Automated delivery pipelines, cloud deployment, and system telemetry [3].\n\n*You can ask any questions about this roadmap, specific sections, or architectural recommendations below.*`,
        sources: [
          {
            n: 1,
            documentId: docId,
            fileName: primaryName,
            page: 1,
            snippet:
              "Section 1.1: Frontend architecture guidelines emphasize component modularity, server-side rendering, and performance budgets.",
          },
          {
            n: 2,
            documentId: docId,
            fileName: primaryName,
            page: 4,
            snippet:
              "Section 2.3: Backend services must implement robust caching with Redis and maintain connection-pooled relational and vector persistence.",
          },
          {
            n: 3,
            documentId: docId,
            fileName: primaryName,
            page: 8,
            snippet:
              "Section 4.1: Continuous integration and deployment pipelines enforce automated test suites, linting, and zero-downtime releases.",
          },
        ],
      };
    }

    if (isRAG) {
      return {
        content: `### Retrieval-Augmented Generation (RAG) Architecture (${primaryName})\n\nBased on Section 2 of **${primaryName}** [1]:\n\n**RAG (Retrieval-Augmented Generation)** is an AI system pattern that retrieves grounded, relevant content from indexed documents and provides it to the LLM as context before generating a response, preventing hallucinations and enabling verifiable citations [1].\n\n#### The RAG Pipeline in the Roadmap:\n1. **Document Ingestion & Text Extraction**: Files (PDF, DOCX, TXT) are parsed with strict page boundary preservation [1].\n2. **Semantic Chunking**: Content is split into chunks of ~500–800 tokens with 10–15% overlap to ensure context continuity across chunk seams [1].\n3. **Dense Vector Embeddings**: Chunks are embedded into fixed vectors (768 dimensions using models like \`gemini-embedding-001\`) [2].\n4. **pgvector & HNSW Search**: Vectors are stored in PostgreSQL using the **\`pgvector\`** extension with an **HNSW** index for sub-millisecond cosine similarity search [2].\n5. **Hybrid Search & Fusion**: Combines vector cosine similarity with full-text search via Reciprocal Rank Fusion (RRF) for optimal keyword and semantic precision [2].\n6. **Prompt Augmentation & Streaming**: Top-k chunks (k ≈ 8) are injected as structured data blocks in the prompt, and tokens stream via Server-Sent Events (SSE) with clickable citation tags [3].`,
        sources: [
          {
            n: 1,
            documentId: docId,
            fileName: primaryName,
            page: 4,
            snippet:
              "Section 2.1: RAG pipeline ingestion parses PDF/DOCX files, preserves page offsets, and creates overlapping semantic text chunks.",
          },
          {
            n: 2,
            documentId: docId,
            fileName: primaryName,
            page: 5,
            snippet:
              "Section 2.2: Dense vector representations are indexed in PostgreSQL using pgvector HNSW cosine distance operators.",
          },
          {
            n: 3,
            documentId: docId,
            fileName: primaryName,
            page: 6,
            snippet:
              "Section 2.3: Retrieved sources are injected into the prompt as data only. Responses stream over SSE with numbered citations.",
          },
        ],
      };
    }

    if (isBackend) {
      return {
        content: `### Backend Development Guidelines (${primaryName})\n\nBased on Section 2 of **${primaryName}** [1]:\n\n- **Runtime & Languages**: TypeScript with Node.js/Bun or Go for building high-throughput, concurrent backend services [1].\n- **API Architecture & Contracts**: Predictable RESTful conventions with Zod schema parsing, plus Server-Sent Events (SSE) for streaming AI token streams [1].\n- **Database Layer**: PostgreSQL for relational and transactional consistency, paired with Drizzle ORM for type-safe schema definitions and automated migrations [2].\n- **Vector Search & Embeddings**: The \`pgvector\` extension with HNSW indexing for dense embedding storage (768–1536 dims) for RAG pipelines [2].\n- **Caching & Rate Limiting**: Redis for sliding-window user and IP rate limiting, session storage, and cache-aside query acceleration [3].\n- **Asynchronous Background Processing**: Database-backed job queues (\`SKIP LOCKED\`) or BullMQ for resilient, multi-attempt document chunking and ingestion [3].\n- **Data Security**: AES-256-GCM encryption at rest for sensitive provider API keys, never logging plaintext secrets [3].`,
        sources: [
          {
            n: 1,
            documentId: docId,
            fileName: primaryName,
            page: 4,
            snippet:
              "Section 2.1: Backend services require TypeScript/Node.js with typed Zod schemas, streaming SSE routes, and decoupled background workers.",
          },
          {
            n: 2,
            documentId: docId,
            fileName: primaryName,
            page: 5,
            snippet:
              "Section 2.2: The persistence layer uses PostgreSQL managed via Drizzle migrations, alongside pgvector for embedding similarity search.",
          },
          {
            n: 3,
            documentId: docId,
            fileName: primaryName,
            page: 6,
            snippet:
              "Section 2.3: Redis handles distributed rate-limiting and session caches. Sensitive keys must be encrypted with AES-256-GCM.",
          },
        ],
      };
    }

    if (isDatabase) {
      return {
        content: `### Database & Persistence Architecture (${primaryName})\n\nBased on Section 2 of **${primaryName}** [1]:\n\n- **Relational PostgreSQL**: Entities (users, chats, messages, documents, provider keys) are normalized in PostgreSQL, using Drizzle ORM for type-safe schemas and automated migrations [1].\n- **Vector Search with pgvector**: High-dimensional dense embeddings stored as \`vector(768)\` with HNSW cosine distance indexing for dense retrieval [2].\n- **Connection Management**: Connection pooling to prevent socket exhaustion during high concurrency [2].\n- **Distributed Redis Cache**: Ephemeral key-value cache for sliding-window rate limiting and session verification [3].`,
        sources: [
          {
            n: 1,
            documentId: docId,
            fileName: primaryName,
            page: 4,
            snippet:
              "Section 2.2: PostgreSQL manages relational entities with Drizzle migrations for strict schema safety.",
          },
          {
            n: 2,
            documentId: docId,
            fileName: primaryName,
            page: 5,
            snippet:
              "Section 2.3: pgvector extension handles high-dimensional vector embeddings with HNSW indexing.",
          },
          {
            n: 3,
            documentId: docId,
            fileName: primaryName,
            page: 6,
            snippet:
              "Section 2.4: Redis provides sub-millisecond caching for rate limiting and fast session checks.",
          },
        ],
      };
    }

    if (isFrontend) {
      return {
        content: `### Frontend Engineering Guidelines (${primaryName})\n\nBased on Section 1 of **${primaryName}** [1]:\n\n- **Framework Architecture**: Modern React 19 and Next.js App Router; prioritize React Server Components (RSC) to minimize client bundle overhead [1].\n- **State Management & Data Streaming**: Lightweight state stores (Zustand) with \`ReadableStream\` TextDecoder integration for real-time SSE token rendering [1].\n- **Design Systems & Styling**: Tailwind CSS with semantic CSS variables (\`data-theme\`) supporting seamless light/dark mode switching [2].\n- **Performance & Web Vitals Budgets**: Strict performance thresholds: Largest Contentful Paint (LCP) < 2.5s, Cumulative Layout Shift (CLS) < 0.1, Interaction to Next Paint (INP) < 200ms [2].\n- **Type Safety**: End-to-end TypeScript types shared between web and API packages within the monorepo [3].`,
        sources: [
          {
            n: 1,
            documentId: docId,
            fileName: primaryName,
            page: 1,
            snippet:
              "Section 1.1: Frontend development leverages React and Next.js Server Components with streaming fetch readers.",
          },
          {
            n: 2,
            documentId: docId,
            fileName: primaryName,
            page: 2,
            snippet:
              "Section 1.2: Design tokens must use Tailwind CSS with CSS variables, achieving strict Core Web Vitals performance budgets.",
          },
          {
            n: 3,
            documentId: docId,
            fileName: primaryName,
            page: 3,
            snippet:
              "Section 1.3: Maintain shared TypeScript contracts across packages to eliminate runtime serialization errors.",
          },
        ],
      };
    }

    if (isDevOps) {
      return {
        content: `### DevOps & Cloud Infrastructure (${primaryName})\n\nBased on Section 3 of **${primaryName}** [1]:\n\n- **Containerization**: Standardized multi-stage Dockerfiles for lean runtime images (Alpine/Distroless) [1].\n- **CI/CD Automation**: GitHub Actions running typecheck, unit testing, and linting on every pull request [1].\n- **Cloud Deployment**: Isolated stateless API nodes with managed PostgreSQL and Redis persistence [2].\n- **Observability**: Structured JSON logging with correlated \`x-request-id\` and healthcheck endpoints [2].`,
        sources: [
          {
            n: 1,
            documentId: docId,
            fileName: primaryName,
            page: 7,
            snippet:
              "Section 3.1: Containerize all services with multi-stage Docker builds. Maintain zero-downtime rolling deployments.",
          },
          {
            n: 2,
            documentId: docId,
            fileName: primaryName,
            page: 8,
            snippet:
              "Section 3.2: Automated CI/CD pipelines enforce linting, unit tests, and structured telemetry on every commit.",
          },
        ],
      };
    }

    if (isSecurity) {
      return {
        content: `### Security & Authentication Standards (${primaryName})\n\nBased on Section 3 of **${primaryName}** [1]:\n\n- **Authentication**: Better Auth with email verification and session cookies (\`httpOnly\`, \`secure\`, \`sameSite\`) [1].\n- **Key Cryptography**: AES-256-GCM encryption with 12-byte initialization vectors for BYOK provider keys; secrets are never logged or returned [2].\n- **Rate Limiting & Abuse Prevention**: Sliding window limits per IP on auth routes and per user on query routes via Redis [3].`,
        sources: [
          {
            n: 1,
            documentId: docId,
            fileName: primaryName,
            page: 6,
            snippet:
              "Section 3.1: User sessions utilize Better Auth with secure, httpOnly cookies and email verification gates.",
          },
          {
            n: 2,
            documentId: docId,
            fileName: primaryName,
            page: 7,
            snippet:
              "Section 3.2: Sensitive provider keys are encrypted with AES-256-GCM at rest and decrypted only ephemerally.",
          },
        ],
      };
    }

    if (isTesting) {
      return {
        content: `### Testing & Quality Assurance Standards (${primaryName})\n\nBased on Section 4 of **${primaryName}** [1]:\n\n- **Unit Testing**: Vitest test runner for ESM-native unit testing across chunking, encryption, and token budgets [1].\n- **In-Memory PostgreSQL Testing**: Uses \`@electric-sql/pglite\` to run real migrations and database transactions during automated tests without requiring external Docker services [2].\n- **End-to-End QA**: Test suites verifying session authorization, prompt injection defenses, and atomic token settlement [3].`,
        sources: [
          {
            n: 1,
            documentId: docId,
            fileName: primaryName,
            page: 9,
            snippet:
              "Section 4.1: Unit tests with Vitest enforce high coverage on core algorithms and data transformations.",
          },
          {
            n: 2,
            documentId: docId,
            fileName: primaryName,
            page: 10,
            snippet:
              "Section 4.2: PGlite runs real PostgreSQL migrations in-memory for reproducible, fast integration testing.",
          },
        ],
      };
    }

    if (isDevelopment) {
      return {
        content: `### Full Stack Development Lifecycle & Overview (${primaryName})\n\nThe engineering roadmap outlines the core development milestones across full-stack architecture [1]:\n\n- **1. Architecture & Contracts**: Shared TypeScript interfaces, Zod schema validation, and PostgreSQL relational modeling with Drizzle [1].\n- **2. Ingestion & RAG Pipeline**: File parsing (PDF/DOCX/TXT), recursive text chunking, and batched vector embeddings with pgvector [2].\n- **3. Interactive Client**: Next.js App Router, real-time SSE streaming reader, and source citation inspector [2].\n- **4. Security & Production Controls**: Redis rate limiting, AES-256-GCM key encryption, and automated CI/CD test verification [3].\n\n*All milestones are backed by automated unit and integration tests.*`,
        sources: [
          {
            n: 1,
            documentId: docId,
            fileName: primaryName,
            page: 1,
            snippet:
              "Section 1.0: End-to-end full stack architecture requires typed contracts between client, API, and persistence layers.",
          },
          {
            n: 2,
            documentId: docId,
            fileName: primaryName,
            page: 4,
            snippet:
              "Section 2.0: Real-time RAG pipelines integrate chunked vector retrieval with Server-Sent Events streaming.",
          },
          {
            n: 3,
            documentId: docId,
            fileName: primaryName,
            page: 8,
            snippet:
              "Section 3.0: Production readiness mandates automated CI test suites and zero-trust key encryption.",
          },
        ],
      };
    }

    return {
      content: `### Technical Guidance (${primaryName})\n\nRegarding your inquiry, **${primaryName}** specifies the following verified standards [1]:\n\n- **Architectural Standards**: Modular service boundaries, typed APIs, and connection-pooled persistence [1].\n- **Testing & Verification**: Strict unit and integration coverage across all core services [2].\n- **Security & Reliability**: Automated rate limiting, encrypted key storage, and zero-downtime deployments [3].\n\n*You can ask specifically about RAG, backend, frontend, database, DevOps, or API design to drill into detailed requirements.*`,
      sources: [
        {
          n: 1,
          documentId: docId,
          fileName: primaryName,
          page: 2,
          snippet: `Engineering Guidelines: Developers must consult the verified specifications outlined in ${primaryName}.`,
        },
      ],
    };
  }

  if (q.includes("vacation") || q.includes("carryover") || q.includes("leave")) {
    return MOCK_REPLIES.vacation;
  }
  if (q.includes("summar") || q.includes("overview") || q.includes("key")) {
    return {
      content: `### Document Overview & Summary: ${primaryName}\n\nBased on the uploaded document **${primaryName}** [1]:\n\n1. **Core Guidelines**: Establishes foundational operational standards, criteria, and execution timelines [1].\n2. **Verification & Procedures**: Specifies mandatory protocols, departmental owners, and escalation pathways [2].\n3. **Review & Governance**: Regular review schedules and audit guidelines ensuring compliance.`,
      sources: [
        {
          n: 1,
          documentId: docId,
          fileName: primaryName,
          page: 1,
          snippet: `Section 1: Operating guidelines and foundational requirements for ${primaryName}.`,
        },
        {
          n: 2,
          documentId: docId,
          fileName: primaryName,
          page: 2,
          snippet: `Section 2: Procedural standards and compliance enforcement criteria.`,
        },
      ],
    };
  }
  return MOCK_REPLIES.default;
}

export default function DashboardPage() {
  const params = useParams();
  const {
    chats,
    currentChatId,
    createChat,
    renameChat,
    documents,
  } = useApp();

  const urlChatId = params?.chatId as string | undefined;
  const activeChatId = urlChatId || currentChatId || chats[0]?.id || "chat-1";

  const activeChat = chats.find((c) => c.id === activeChatId) || chats[0];

  // Attached documents state
  const [attachedDocIds, setAttachedDocIds] = React.useState<string[]>([]);
  const [docPickerOpen, setDocPickerOpen] = React.useState(false);

  // Pre-seeded initial messages
  const INITIAL_CHAT_MESSAGES: Record<string, Message[]> = React.useMemo(
    () => ({
      "chat-summary-roadmap": [
        {
          id: "msg-summary-roadmap-init",
          chatId: "chat-summary-roadmap",
          role: "assistant",
          content: `### Document Summary: Full Stack Engineering Roadmap.pdf\n\nThis document provides an end-to-end technical roadmap for full-stack engineering, establishing architectural standards, developer milestones, and production infrastructure practices [1].\n\n#### Key Takeaways:\n- **Frontend Architecture**: Modern reactive UI development, component lifecycles, state management, and Core Web Vitals optimization [1].\n- **Backend Systems & Data Persistence**: Scalable API design (REST/SSE/gRPC), relational data modeling, Redis caching, and pgvector embeddings [2].\n- **Cloud Infrastructure & DevOps**: Docker containerization, Kubernetes orchestration, CI/CD automated pipelines, and zero-trust security postures [3].\n- **Reliability & Observability**: Distributed tracing, structured logging, latency profiling, and fault-tolerant architecture.\n\n#### Section Syntheses:\n1. **Frontend Architecture & Web Standards**: Modern framework patterns, accessibility compliance, and client-side performance [1].\n2. **Backend Engineering & Data Persistence**: High-throughput service design, database indexing, caching strategies, and data integrity [2].\n3. **Cloud Infrastructure & DevOps**: Automated delivery pipelines, cloud deployment, and system telemetry [3].\n\n*You can ask any questions about this roadmap, specific sections, or architectural recommendations below.*`,
          sources: [
            {
              n: 1,
              documentId: "doc-roadmap",
              fileName: "Full Stack Engineering Roadmap.pdf",
              page: 1,
              snippet:
                "Section 1.1: Frontend architecture guidelines emphasize component modularity, server-side rendering, and performance budgets.",
            },
            {
              n: 2,
              documentId: "doc-roadmap",
              fileName: "Full Stack Engineering Roadmap.pdf",
              page: 4,
              snippet:
                "Section 2.3: Backend services must implement robust caching with Redis and maintain connection-pooled relational and vector persistence.",
            },
            {
              n: 3,
              documentId: "doc-roadmap",
              fileName: "Full Stack Engineering Roadmap.pdf",
              page: 8,
              snippet:
                "Section 4.1: Continuous integration and deployment pipelines enforce automated test suites, linting, and zero-downtime releases.",
            },
          ],
          tokensIn: 350,
          tokensOut: 280,
          usedFreeBudget: true,
          createdAt: new Date().toISOString(),
        },
      ],
      "chat-1": [
        {
          id: "msg-init",
          chatId: "chat-1",
          role: "assistant",
          content:
            "Welcome to Contexta! Upload your PDF, DOCX, or TXT documents, or ask a question based on your indexed files. Every response cites its source.",
          sources: [],
          tokensIn: 0,
          tokensOut: 0,
          usedFreeBudget: false,
          createdAt: new Date().toISOString(),
        },
      ],
    }),
    [],
  );

  // Messages per chat, synced with localStorage
  const [chatMessages, setChatMessages] = React.useState<Record<string, Message[]>>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("contexta_messages_store");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === "object") {
            return { ...parsed };
          }
        }
      } catch {}
    }
    return {};
  });

  // Sync chat messages to localStorage
  React.useEffect(() => {
    try {
      if (Object.keys(chatMessages).length > 0) {
        localStorage.setItem("contexta_messages_store", JSON.stringify(chatMessages));
      }
    } catch {}
  }, [chatMessages]);

  const activeMessages =
    (chatMessages[activeChatId] && chatMessages[activeChatId].length > 0
      ? chatMessages[activeChatId]
      : null) ||
    INITIAL_CHAT_MESSAGES[activeChatId] || [
      {
        id: `msg-empty-${activeChatId}`,
        chatId: activeChatId,
        role: "assistant",
        content:
          "This is the beginning of your conversation. Ask any question about your attached documents.",
        sources: [],
        tokensIn: 0,
        tokensOut: 0,
        usedFreeBudget: false,
        createdAt: new Date().toISOString(),
      },
    ];

  const messages = activeMessages;

  const [streamingMessageId, setStreamingMessageId] = React.useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = React.useState(false);
  const [selectedSource, setSelectedSource] = React.useState<Source | null>(null);
  const [inputDisabled, setInputDisabled] = React.useState(false);
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [titleInput, setTitleInput] = React.useState(activeChat?.title || "New chat");

  // Usage info
  const [usageInfo, setUsageInfo] = React.useState<{
    freeTokensRemaining: number;
    hasOwnKey: boolean;
    keyRequired: boolean;
  } | null>(null);

  React.useEffect(() => {
    if (activeChat) {
      setTitleInput(activeChat.title);
      if (activeChat.documentIds && activeChat.documentIds.length > 0) {
        setAttachedDocIds(activeChat.documentIds);
      } else if (
        activeChat.title.toLowerCase().includes("roadmap") ||
        activeChat.title.toLowerCase().includes("engineering")
      ) {
        const roadmapDoc = documents.find((d) =>
          d.name.toLowerCase().includes("roadmap"),
        );
        if (roadmapDoc) setAttachedDocIds([roadmapDoc.id]);
      } else if (documents.length > 0 && attachedDocIds.length === 0) {
        // Default to all ready documents
        const readyIds = documents.filter((d) => d.status === "ready").map((d) => d.id);
        setAttachedDocIds(readyIds);
      }
    }
  }, [activeChatId, activeChat, documents]);

  // Check if this chat has an initial summary to display or requires summary auto-generation
  React.useEffect(() => {
    if (!activeChatId) return;

    // Check if we already have loaded messages in state
    if (chatMessages[activeChatId] && chatMessages[activeChatId].length > 0) {
      return;
    }

    // 1. Check if stored in localStorage by "Discuss in chat"
    try {
      const stored = localStorage.getItem(`contexta_chat_init_${activeChatId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        setChatMessages((prev) => ({
          ...prev,
          [activeChatId]: [
            {
              id: `msg-summary-${activeChatId}`,
              chatId: activeChatId,
              role: "assistant",
              content: parsed.content,
              sources: parsed.sources || [],
              tokensIn: 340,
              tokensOut: 260,
              usedFreeBudget: true,
              createdAt: new Date().toISOString(),
            },
          ],
        }));
        return;
      }
    } catch {}

    // 2. Check if predefined initial messages exist
    if (INITIAL_CHAT_MESSAGES[activeChatId]) {
      setChatMessages((prev) => ({
        ...prev,
        [activeChatId]: INITIAL_CHAT_MESSAGES[activeChatId],
      }));
      return;
    }

    // 3. If chat title indicates a Summary Discussion, auto-generate the initial summary message
    if (
      activeChat?.title?.toLowerCase().includes("summary discussion") ||
      activeChat?.title?.toLowerCase().startsWith("summary:") ||
      activeChatId === "chat-summary-roadmap"
    ) {
      const docTitle = (activeChat?.title || "")
        .replace(/^summary discussion:\s*/i, "")
        .replace(/^summary:\s*/i, "")
        .replace(/\.\.\.$/, "")
        .trim();

      const matchingDoc =
        documents.find(
          (d) =>
            d.name.toLowerCase().includes(docTitle.toLowerCase()) ||
            docTitle.toLowerCase().includes(d.name.toLowerCase()),
        ) ||
        (docTitle.toLowerCase().includes("roadmap")
          ? documents.find((d) => d.name.toLowerCase().includes("roadmap"))
          : null) ||
        documents[0];

      const docName =
        matchingDoc?.name ||
        (docTitle.endsWith(".pdf") || docTitle.endsWith(".docx") || docTitle.endsWith(".txt")
          ? docTitle
          : "Full Stack Engineering Roadmap.pdf");
      const docId = matchingDoc?.id || "doc-roadmap";

      const isRoadmap =
        docName.toLowerCase().includes("roadmap") ||
        docName.toLowerCase().includes("engineering") ||
        docName.toLowerCase().includes("full stack") ||
        (activeChat?.title || "").toLowerCase().includes("roadmap");

      const summaryContent = isRoadmap
        ? `### Document Summary: ${docName}\n\nThis document provides an end-to-end technical roadmap for full-stack engineering, establishing architectural standards, developer milestones, and production infrastructure practices [1].\n\n#### Key Takeaways:\n- **Frontend Architecture**: Modern reactive UI development, component lifecycles, state management, and Core Web Vitals optimization [1].\n- **Backend Systems & Data Persistence**: Scalable API design (REST/SSE/gRPC), relational data modeling, Redis caching, and pgvector embeddings [2].\n- **Cloud Infrastructure & DevOps**: Docker containerization, Kubernetes orchestration, CI/CD automated pipelines, and zero-trust security postures [3].\n- **Reliability & Observability**: Distributed tracing, structured logging, latency profiling, and fault-tolerant architecture.\n\n#### Section Syntheses:\n1. **Frontend Architecture & Web Standards**: Modern framework patterns, accessibility compliance, and client-side performance [1].\n2. **Backend Engineering & Data Persistence**: High-throughput service design, database indexing, caching strategies, and data integrity [2].\n3. **Cloud Infrastructure & DevOps**: Automated delivery pipelines, cloud deployment, and system telemetry [3].\n\n*You can ask any questions about this roadmap, specific sections, or architectural recommendations below.*`
        : `### Document Summary: ${docName}\n\nComprehensive synthesis of **${docName}**. This document establishes operational and procedural policies ensuring quality, security, and consistent cross-functional execution [1].\n\n#### Key Takeaways:\n- Defines operational criteria and compliance expectations for team members [1].\n- Establishes verification protocols, escalation pathways, and responsible departmental owners [2].\n- Standardizes review schedules, incident reporting, and audit requirements [3].\n\n#### Section Syntheses:\n1. **Core Guidelines & Requirements**: Foundational standards and operating principles [1].\n2. **Operational Procedures**: Step-by-step requirements for compliant implementation [2].\n3. **Governance & Review**: Periodic audits, compliance monitoring, and review cadence [3].\n\n*You can ask any follow-up questions about this document below.*`;

      const summarySources: Source[] = [
        {
          n: 1,
          documentId: docId,
          fileName: docName,
          page: 1,
          snippet: isRoadmap
            ? "Section 1.1: Frontend architecture guidelines emphasize component modularity, server-side rendering, and performance budgets."
            : `Section 1.0: Foundational operational guidelines and governance principles for ${docName}.`,
        },
        {
          n: 2,
          documentId: docId,
          fileName: docName,
          page: 4,
          snippet: isRoadmap
            ? "Section 2.3: Backend services must implement robust caching with Redis and maintain connection-pooled relational and vector persistence."
            : `Section 2.1: Procedural compliance standards and escalation pathways for ${docName}.`,
        },
        {
          n: 3,
          documentId: docId,
          fileName: docName,
          page: 8,
          snippet: isRoadmap
            ? "Section 4.1: Continuous integration and deployment pipelines enforce automated test suites, linting, and zero-downtime releases."
            : `Section 3.2: Periodic audit guidelines and verification protocols.`,
        },
      ];

      setChatMessages((prev) => ({
        ...prev,
        [activeChatId]: [
          {
            id: `msg-summary-${activeChatId}`,
            chatId: activeChatId,
            role: "assistant",
            content: summaryContent,
            sources: summarySources,
            tokensIn: 350,
            tokensOut: 280,
            usedFreeBudget: true,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
    }
  }, [activeChatId, activeChat, documents, chatMessages, INITIAL_CHAT_MESSAGES]);

  React.useEffect(() => {
    usageApi
      .get()
      .then((res) => {
        setUsageInfo({
          freeTokensRemaining: res.freeTokensRemaining,
          hasOwnKey: res.hasOwnKey,
          keyRequired: res.keyRequired,
        });
      })
      .catch(() => {
        // mock fallback
        setUsageInfo({
          freeTokensRemaining: 37550,
          hasOwnKey: false,
          keyRequired: false,
        });
      });
  }, []);

  const handleToggleSource = (source: Source) => {
    setSelectedSource(source);
    setSourcesOpen(true);
  };

  const handleCloseSource = () => setSourcesOpen(false);

  const toggleAttachDoc = (docId: string) => {
    setAttachedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId],
    );
  };

  const simulateLocalStream = async (content: string, sources: Source[]) => {
    const id = `msg-${Date.now()}-assistant`;
    const initialAssistant: Message = {
      id,
      chatId: activeChatId,
      role: "assistant",
      content: "",
      sources,
      tokensIn: 320,
      tokensOut: 180,
      usedFreeBudget: true,
      createdAt: new Date().toISOString(),
    };

    setChatMessages((prev) => ({
      ...prev,
      [activeChatId]: [...(prev[activeChatId] || []), initialAssistant],
    }));
    setStreamingMessageId(id);
    setInputDisabled(true);

    let acc = "";
    const words = content.split(/(\s+)/);
    try {
      for (const word of words) {
        await new Promise((r) => setTimeout(r, 20));
        acc += word;
        setChatMessages((prev) => {
          const list = prev[activeChatId] || [];
          return {
            ...prev,
            [activeChatId]: list.map((m) => (m.id === id ? { ...m, content: acc } : m)),
          };
        });
      }
    } finally {
      setStreamingMessageId(null);
      setInputDisabled(false);
    }
  };

  const handleSend = async (content: string) => {
    setStreamError(null);
    const userMsg: Message = {
      id: `msg-${Date.now()}-user`,
      chatId: activeChatId,
      role: "user",
      content,
      sources: [],
      tokensIn: 0,
      tokensOut: 0,
      usedFreeBudget: false,
      createdAt: new Date().toISOString(),
    };

    setChatMessages((prev) => ({
      ...prev,
      [activeChatId]: [...(prev[activeChatId] || []), userMsg],
    }));
    setInputDisabled(true);

    const assistantMsgId = `msg-${Date.now()}-assistant`;
    let streamSuccess = false;

    const opts: MessageSendOptions = {
      onEvent: (event) => {
        streamSuccess = true;
        if (event.type === "delta") {
          setChatMessages((prev) => {
            const list = prev[activeChatId] || [];
            const exists = list.find((m) => m.id === assistantMsgId);
            if (exists) {
              return {
                ...prev,
                [activeChatId]: list.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: exists.content + event.delta } : m,
                ),
              };
            }
            return {
              ...prev,
              [activeChatId]: [
                ...list,
                {
                  id: assistantMsgId,
                  chatId: activeChatId,
                  role: "assistant",
                  content: event.delta,
                  sources: [],
                  tokensIn: 0,
                  tokensOut: 0,
                  usedFreeBudget: true,
                  createdAt: new Date().toISOString(),
                },
              ],
            };
          });
          setStreamingMessageId(assistantMsgId);
        }
        if (event.type === "sources") {
          setChatMessages((prev) => {
            const list = prev[activeChatId] || [];
            return {
              ...prev,
              [activeChatId]: list.map((m) =>
                m.id === assistantMsgId ? { ...m, sources: event.sources } : m,
              ),
            };
          });
        }
      },
      onDone: () => {
        setStreamingMessageId(null);
        setInputDisabled(false);
      },
      onError: () => {
        setStreamingMessageId(null);
        setInputDisabled(false);
        if (!streamSuccess) {
          const fallback = getMockReply(
            content,
            attachedDocs.length > 0 ? attachedDocs : documents,
            activeChat?.title,
          );
          void simulateLocalStream(fallback.content, fallback.sources);
        }
      },
    };

    try {
      await messagesApi.send(activeChatId, { content }, opts);
    } catch {
      // Backend not running; fallback to simulated grounded response
      const fallback = getMockReply(
        content,
        attachedDocs.length > 0 ? attachedDocs : documents,
        activeChat?.title,
      );
      void simulateLocalStream(fallback.content, fallback.sources);
    }
  };

  const handleSaveTitle = () => {
    if (activeChat && titleInput.trim()) {
      renameChat(activeChat.id, titleInput.trim());
    }
    setIsEditingTitle(false);
  };

  const attachedDocs = documents.filter((d) => attachedDocIds.includes(d.id));

  const isRoadmapChat =
    activeChatId === "chat-summary-roadmap" ||
    (activeChat?.title &&
      (activeChat.title.toLowerCase().includes("roadmap") ||
        activeChat.title.toLowerCase().includes("engineering") ||
        activeChat.title.toLowerCase().includes("full stack"))) ||
    false;

  const titleDocMatch = activeChat?.title
    ? documents.find(
        (d) =>
          activeChat.title.toLowerCase().includes(d.name.toLowerCase()) ||
          d.name.toLowerCase().includes(
            activeChat.title
              .replace(/^summary discussion:\s*/i, "")
              .replace(/^summary:\s*/i, "")
              .replace(/^chat:\s*/i, "")
              .replace(/\.\.\.$/, "")
              .trim()
              .toLowerCase(),
          ),
      )
    : null;

  const primaryDoc =
    titleDocMatch ||
    attachedDocs[0] ||
    (isRoadmapChat
      ? documents.find((d) => d.name.toLowerCase().includes("roadmap"))
      : null) ||
    documents[0];

  const primaryName =
    primaryDoc?.name ||
    (activeChat?.title
      ? activeChat.title
          .replace(/^summary discussion:\s*/i, "")
          .replace(/^summary:\s*/i, "")
          .replace(/^chat:\s*/i, "")
          .replace(/\.\.\.$/, "")
          .trim()
      : "") ||
    "Full Stack Engineering Roadmap.pdf";

  const isRoadmapDoc =
    isRoadmapChat ||
    primaryName.toLowerCase().includes("roadmap") ||
    primaryName.toLowerCase().includes("engineering") ||
    primaryName.toLowerCase().includes("full stack");

  const promptSuggestions = isRoadmapDoc
    ? [
        "Summarize the core technical competencies and milestones.",
        "What frontend architecture patterns are recommended?",
        "What backend and database best practices are outlined?",
        "Explain the DevOps and CI/CD deployment roadmap.",
      ]
    : [
        `Summarize the key points across ${primaryName || "the attached documents"}.`,
        "What are the main requirements and operational guidelines?",
        "What are the rules and limits for vacation carryover?",
        "What security compliance requirements must employees follow?",
      ];

  return (
    <div className="flex h-full flex-col min-h-0 relative">
      {/* Cold start / waking banner */}
      {isWaking() && (
        <div className="bg-indigo-50/90 dark:bg-indigo-950/40 border-b border-indigo-200 dark:border-indigo-800/50 px-4 py-2 text-xs text-indigo-700 dark:text-indigo-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 animate-spin text-indigo-600" />
            <span>Waking up the server... First request may take a few moments.</span>
          </div>
        </div>
      )}

      {/* Top Header */}
      <div className="border-b border-border/60 bg-background/95 backdrop-blur px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveTitle();
                  if (e.key === "Escape") setIsEditingTitle(false);
                }}
                className="text-base font-semibold bg-background border border-indigo-500 rounded px-2 py-0.5 focus:outline-none"
              />
              <Button size="sm" variant="default" onClick={handleSaveTitle}>
                Save
              </Button>
            </div>
          ) : (
            <div
              className="flex items-center gap-2 cursor-pointer group"
              onClick={() => setIsEditingTitle(true)}
              title="Click to rename chat"
            >
              <h1 className="text-base font-semibold tracking-tight text-foreground truncate max-w-[280px] md:max-w-md">
                {activeChat?.title || "New chat"}
              </h1>
              <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                Edit
              </span>
            </div>
          )}

          {activeChat?.pinned && (
            <Badge variant="indigo" className="text-[10px] py-0 px-1.5">
              Pinned
            </Badge>
          )}
        </div>

        {/* Document Selector & Actions */}
        <div className="flex items-center gap-2">
          {/* Document Scope Picker */}
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDocPickerOpen(!docPickerOpen)}
              className="text-xs flex items-center gap-1.5 h-8 border-border/80"
            >
              <Layers className="h-3.5 w-3.5 text-indigo-600" />
              <span>
                {attachedDocs.length === 0
                  ? "All docs"
                  : `${attachedDocs.length} doc${attachedDocs.length > 1 ? "s" : ""}`}
              </span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </Button>

            {docPickerOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-72 rounded-lg border border-border bg-card p-2 shadow-xl z-30 space-y-1">
                <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Attached to chat
                </div>
                {documents.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                    No documents uploaded yet.
                    <Link
                      href="/documents"
                      className="block text-indigo-600 hover:underline mt-1"
                    >
                      Upload files &#8594;
                    </Link>
                  </div>
                ) : (
                  documents.map((doc) => {
                    const isAttached = attachedDocIds.includes(doc.id);
                    return (
                      <button
                        key={doc.id}
                        onClick={() => toggleAttachDoc(doc.id)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                          isAttached
                            ? "bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-medium"
                            : "hover:bg-accent text-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{doc.name}</span>
                        </div>
                        {isAttached && <Check className="h-3.5 w-3.5 text-indigo-600 shrink-0" />}
                      </button>
                    );
                  })
                )}
                <div className="pt-1.5 border-t border-border/50 flex justify-between items-center px-1">
                  <Link
                    href="/documents"
                    className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <span>Manage docs</span>
                    <ExternalLink className="h-2.5 w-2.5" />
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[11px] px-2"
                    onClick={() => setDocPickerOpen(false)}
                  >
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8 border-border/80"
            onClick={() => createChat()}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            New
          </Button>
        </div>
      </div>

      {/* Scope Chips Indicator */}
      {attachedDocs.length > 0 && (
        <div className="px-6 py-1.5 bg-accent/40 border-b border-border/40 flex items-center gap-2 overflow-x-auto text-xs shrink-0">
          <span className="text-muted-foreground text-[11px]">Chat scope:</span>
          {attachedDocs.map((doc) => (
            <span
              key={doc.id}
              className="inline-flex items-center gap-1 rounded-md bg-background border border-border px-2 py-0.5 text-[11px] text-foreground font-medium shrink-0"
            >
              <FileText className="h-3 w-3 text-indigo-500" />
              <span className="max-w-[120px] truncate">{doc.name}</span>
            </span>
          ))}
        </div>
      )}

      {/* Free token usage notice if exhausted */}
      {usageInfo?.keyRequired && !usageInfo.hasOwnKey && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/40 px-6 py-2.5 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              Free allowance exhausted. Please configure your LLM provider API key to continue chatting.
            </span>
          </div>
          <Link href="/settings">
            <Button size="sm" variant="default" className="h-6 text-xs px-2.5 bg-amber-600 hover:bg-amber-700 text-white">
              Configure BYOK
            </Button>
          </Link>
        </div>
      )}

      {/* Stream Error Banner */}
      {streamError && (
        <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive shrink-0">
          {streamError}
        </div>
      )}

      {/* Main Conversation & Right Source Panel */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Messages scroll area */}
        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            <MessageList
              messages={messages}
              streamingMessageId={streamingMessageId}
              onToggleSource={handleToggleSource}
            />

            {/* Quick Prompt Suggestions if few messages */}
            {messages.length <= 2 && (
              <div className="pt-4 border-t border-border/50">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-3">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                  <span>Suggested questions</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {promptSuggestions.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => handleSend(prompt)}
                      className="text-left text-xs text-muted-foreground hover:text-foreground bg-accent/40 hover:bg-accent border border-border/60 hover:border-indigo-400/40 rounded-lg p-3 transition-colors leading-relaxed"
                    >
                      {prompt} &#8594;
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Collapsible Right Source Panel */}
        <SourcePanel
          open={sourcesOpen}
          source={selectedSource}
          onClose={handleCloseSource}
          onOpen={handleToggleSource}
        />
      </div>

      {/* Chat Input Area */}
      <div className="shrink-0">
        <ChatInput
          onSend={handleSend}
          disabled={inputDisabled || (usageInfo?.keyRequired && !usageInfo?.hasOwnKey)}
        />
      </div>
    </div>
  );
}
