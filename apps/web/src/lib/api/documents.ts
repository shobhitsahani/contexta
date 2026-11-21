import { API_ROUTES, type Document, type UploadResponse } from "@contexta/shared";
import { apiRequest } from "./client";

export const documentsApi = {
  list: (): Promise<Document[]> =>
    apiRequest(API_ROUTES.documents.list, { method: "GET" }),
  get: (id: string): Promise<Document> =>
    apiRequest(API_ROUTES.documents.byId(id), { method: "GET" }),
  remove: (id: string): Promise<void> =>
    apiRequest(API_ROUTES.documents.byId(id), { method: "DELETE" }),
  upload: (file: File): Promise<UploadResponse> => {
    const form = new FormData();
    form.append("file", file);
    return apiRequest(API_ROUTES.documents.list, {
      method: "POST",
      body: form,
    }) as Promise<UploadResponse>;
  },
  summary: (id: string): Promise<{ summary: unknown }> =>
    apiRequest(API_ROUTES.documents.summary(id), { method: "GET" }),
};
