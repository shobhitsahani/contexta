import { API_ROUTES, type Source, type StreamEvent } from "@contexta/shared";
import { apiRequest, streamEvents } from "./client";

export interface MessageSendOptions {
  onEvent: (event: StreamEvent) => void;
  onDone: () => void;
  onError: (err: unknown) => void;
  signal?: AbortSignal;
}

export const messagesApi = {
  send: (
    chatId: string,
    body: { content: string },
    opts: MessageSendOptions,
  ): Promise<void> => {
    const controller = new AbortController();
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
    (async () => {
      try {
        for await (const event of streamEvents(
          API_ROUTES.chats.messages(chatId),
          {
            method: "POST",
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        )) {
          opts.onEvent(event as StreamEvent);
          if ((event as { type?: string }).type === "done") {
            opts.onDone();
            return;
          }
        }
      } catch (err) {
        opts.onError(err);
      }
    })();
    return Promise.resolve();
  },
  history: (chatId: string): Promise<{ messages: unknown[] }> =>
    apiRequest(API_ROUTES.chats.messages(chatId), { method: "GET" }),
};

export type { Source };
