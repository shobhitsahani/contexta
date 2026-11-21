"use client";

import * as React from "react";
import { type Message, type Source } from "@contexta/shared";
import { MessageBubble } from "@/components/message-bubble";
import { Skeleton } from "@/components/ui/skeleton";

interface MessageListProps {
  messages: Message[];
  streamingMessageId: string | null;
  onToggleSource: (source: Source) => void;
}

export function MessageList({
  messages,
  streamingMessageId,
  onToggleSource,
}: MessageListProps) {
  return (
    <div className="flex flex-col gap-y-4">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Skeleton className="h-10 w-32 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Start a conversation</p>
        </div>
      )}
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          streaming={streamingMessageId === message.id && message.role === "assistant"}
          onToggleSource={onToggleSource}
        />
      ))}
    </div>
  );
}
