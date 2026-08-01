import type {
  Conversation,
  ConversationMessage,
} from "@/lib/conversations";

export type ConversationDetail = {
  conversation: Conversation;
  messages: ConversationMessage[];
};

export type ActivityRow = {
  id: string;
  label: string;
  detail?: string;
  state: "active" | "success" | "error";
};

export type WorkActivityGroup = {
  id: string;
  title: string;
  state: "active" | "success" | "error";
  rows: ActivityRow[];
};
