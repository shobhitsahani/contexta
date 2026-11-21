"use client";

import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { type Document, type DocumentStatus } from "@contexta/shared";
import { type AppChat } from "@/lib/types";
import { chatsApi, documentsApi } from "@/lib/api";

const INITIAL_CHATS: AppChat[] = [
  {
    id: "chat-summary-roadmap",
    userId: null,
    title: "Summary Discussion: Full Stack Engineering Roadmap.pdf",
    pinned: false,
    documentIds: ["doc-roadmap"],
    createdAt: new Date(Date.now() - 3600000 * 1).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 1).toISOString(),
  },
  {
    id: "chat-1",
    userId: null,
    title: "Employee Policies & Leave",
    pinned: true,
    documentIds: ["doc-1"],
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: "chat-2",
    userId: null,
    title: "Security & MFA Standards",
    pinned: false,
    documentIds: ["doc-2"],
    createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
  },
];

const INITIAL_DOCUMENTS: Document[] = [
  {
    id: "doc-roadmap",
    userId: null,
    name: "Full Stack Engineering Roadmap.pdf",
    mime: "application/pdf",
    sizeBytes: 1024 * 720,
    status: "ready",
    pageCount: 18,
    isDemo: false,
    summaryStatus: "ready",
    createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
  },
  {
    id: "doc-1",
    userId: null,
    name: "Employee_Handbook_2026.pdf",
    mime: "application/pdf",
    sizeBytes: 1024 * 450,
    status: "ready",
    pageCount: 14,
    isDemo: false,
    summaryStatus: "ready",
    createdAt: new Date(Date.now() - 3600000 * 72).toISOString(),
  },
  {
    id: "doc-2",
    userId: null,
    name: "Security_Compliance_v2.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 1024 * 280,
    status: "ready",
    pageCount: 6,
    isDemo: false,
    summaryStatus: "ready",
    createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
  },
  {
    id: "doc-3",
    userId: null,
    name: "Engineering_Onboarding.txt",
    mime: "text/plain",
    sizeBytes: 1024 * 65,
    status: "ready",
    pageCount: 3,
    isDemo: false,
    summaryStatus: "ready",
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
  },
];

interface AppContextType {
  chats: AppChat[];
  documents: Document[];
  currentChatId: string | null;
  setCurrentChatId: (id: string | null) => void;
  createChat: (title?: string, documentIds?: string[]) => string;
  renameChat: (id: string, title: string) => void;
  togglePinChat: (id: string) => void;
  deleteChat: (id: string) => void;
  addDocument: (doc: Document) => void;
  updateDocumentStatus: (id: string, status: DocumentStatus, error?: string | null) => void;
  removeDocument: (id: string) => void;
  simulateIngestion: (docId: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<AppChat[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("contexta_chats");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {}
    }
    return INITIAL_CHATS;
  });

  const [documents, setDocuments] = useState<Document[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("contexta_documents");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {}
    }
    return INITIAL_DOCUMENTS;
  });

  const [currentChatId, setCurrentChatIdState] = useState<string | null>(
    () => INITIAL_CHATS[0]?.id || "chat-summary-roadmap",
  );

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("contexta_chats", JSON.stringify(chats));
    } catch {}
  }, [chats]);

  useEffect(() => {
    try {
      localStorage.setItem("contexta_documents", JSON.stringify(documents));
    } catch {}
  }, [documents]);

  // Fetch initial chats and documents if backend is reachable
  useEffect(() => {
    chatsApi
      .list()
      .then((serverChats) => {
        if (serverChats && serverChats.length > 0) {
          setChats(serverChats);
          setCurrentChatIdState(serverChats[0].id);
        }
      })
      .catch(() => {
        // Backend offline, keep local state
      });

    documentsApi
      .list()
      .then((serverDocs) => {
        if (serverDocs && serverDocs.length > 0) {
          setDocuments(serverDocs);
        }
      })
      .catch(() => {
        // Backend offline, keep local state
      });
  }, []);

  const createChat = useCallback((title = "New conversation", documentIds: string[] = []): string => {
    const id = `chat-${Date.now()}`;
    const now = new Date().toISOString();
    const newChat: AppChat = {
      id,
      userId: null,
      title,
      pinned: false,
      documentIds,
      createdAt: now,
      updatedAt: now,
    };
    setChats((prev) => [newChat, ...prev]);
    setCurrentChatIdState(id);

    try {
      chatsApi.create({ title, documentIds }).catch(() => {});
    } catch {
      // ignore
    }
    return id;
  }, []);

  const renameChat = useCallback((id: string, title: string) => {
    setChats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title, updatedAt: new Date().toISOString() } : c)),
    );
    try {
      chatsApi.patch(id, { title }).catch(() => {});
    } catch {
      // ignore
    }
  }, []);

  const togglePinChat = useCallback((id: string) => {
    setChats((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          const nextPinned = !c.pinned;
          try {
            chatsApi.patch(id, { pinned: nextPinned }).catch(() => {});
          } catch {
            // ignore
          }
          return { ...c, pinned: nextPinned, updatedAt: new Date().toISOString() };
        }
        return c;
      }),
    );
  }, []);

  const deleteChat = useCallback((id: string) => {
    setChats((prev) => prev.filter((c) => c.id !== id));
    setCurrentChatIdState((curr) => {
      if (curr === id) {
        return null;
      }
      return curr;
    });
    try {
      chatsApi.remove(id).catch(() => {});
    } catch {
      // ignore
    }
  }, []);

  const addDocument = useCallback((doc: Document) => {
    setDocuments((prev) => (prev.some((d) => d.id === doc.id) ? prev : [doc, ...prev]));
  }, []);

  const updateDocumentStatus = useCallback(
    (id: string, status: DocumentStatus, error?: string | null) => {
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, status, error: error !== undefined ? error : d.error } : d,
        ),
      );
    },
    [],
  );

  const removeDocument = useCallback((id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    try {
      documentsApi.remove(id).catch(() => {});
    } catch {
      // ignore
    }
  }, []);

  // Simulates realistic background ingestion stages: queued -> parsing -> embedding -> ready
  const simulateIngestion = useCallback(
    async (docId: string) => {
      const steps: DocumentStatus[] = ["parsing", "embedding", "ready"];
      for (const step of steps) {
        await new Promise((r) => setTimeout(r, 1800));
        updateDocumentStatus(docId, step);
      }
    },
    [updateDocumentStatus],
  );

  return (
    <AppContext.Provider
      value={{
        chats,
        documents,
        currentChatId,
        setCurrentChatId: setCurrentChatIdState,
        createChat,
        renameChat,
        togglePinChat,
        deleteChat,
        addDocument,
        updateDocumentStatus,
        removeDocument,
        simulateIngestion,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return ctx;
}
