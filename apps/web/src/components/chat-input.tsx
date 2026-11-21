"use client";

import * as React from "react";
import { Send, Paperclip, CornerDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    // Auto-resize textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  };

  return (
    <div className="border-t border-border/80 bg-background/95 backdrop-blur p-4 md:px-8">
      <div className="max-w-3xl mx-auto">
        <form
          onSubmit={handleSubmit}
          className="relative flex flex-col rounded-xl border border-input bg-card shadow-sm focus-within:border-indigo-600 focus-within:ring-1 focus-within:ring-indigo-600 transition-all"
        >
          <textarea
            ref={textareaRef}
            id="message-input"
            rows={1}
            placeholder={
              disabled
                ? "Input disabled..."
                : "Ask anything about your uploaded documents..."
            }
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className="w-full resize-none bg-transparent px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none min-h-[48px] max-h-[160px]"
          />

          <div className="flex items-center justify-between px-3 py-2 border-t border-border/40 bg-accent/20 rounded-b-xl text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <Link
                href="/documents"
                className="flex items-center gap-1 hover:text-foreground transition-colors"
                title="Manage and upload documents"
              >
                <Paperclip className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Attach documents</span>
              </Link>
              <span className="hidden md:flex items-center gap-1 text-[11px] text-muted-foreground/80">
                <CornerDownLeft className="h-3 w-3" />
                <span>Enter to send, Shift+Enter for newline</span>
              </span>
            </div>

            <Button
              type="submit"
              size="sm"
              disabled={disabled || !value.trim()}
              className="h-7 px-3 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-xs transition-colors"
            >
              <Send className="h-3 w-3 mr-1" />
              <span>Send</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
