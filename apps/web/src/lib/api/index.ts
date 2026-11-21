export { authApi } from "./auth";
export { documentsApi } from "./documents";
export { chatsApi } from "./chats";
export { messagesApi, type MessageSendOptions } from "./messages";
export { settingsApi } from "./settings";
export { usageApi } from "./usage";
export type { AppError } from "@/lib/types";
export { apiRequest, streamEvents, isWaking, markWaking } from "./client";
