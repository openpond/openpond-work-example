import type {
  Conversation,
  ConversationMessage,
  ConversationOutput,
} from "@/lib/conversations";

export type ConversationDetail = {
  conversation: Conversation;
  messages: ConversationMessage[];
  outputs: ConversationOutput[];
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
  outputs: ConversationOutput[];
};
