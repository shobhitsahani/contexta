import { API_ROUTES } from "@contexta/shared";
import { apiRequest } from "./client";
import type { AppChat, CreateChatBody, CreateChatInput, UpdateChatInput } from "@/lib/types";

export const chatsApi = {
  list: (): Promise<AppChat[]> =>
    apiRequest(API_ROUTES.chats.list, { method: "GET" }),
  get: (id: string): Promise<AppChat> =>
    apiRequest(API_ROUTES.chats.byId(id), { method: "GET" }),
  create: (data: CreateChatInput): Promise<CreateChatBody> =>
    apiRequest(API_ROUTES.chats.list, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  patch: (id: string, data: UpdateChatInput): Promise<AppChat> =>
    apiRequest(API_ROUTES.chats.byId(id), {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  remove: (id: string): Promise<void> =>
    apiRequest(API_ROUTES.chats.byId(id), { method: "DELETE" }),
};
