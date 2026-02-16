export type ChannelName = "webchat" | "telegram";

export interface PairingRecord {
  channel: ChannelName;
  senderId: string;
  approved: boolean;
  code: string;
  createdAt: string;
}

export interface MessageRecord {
  id: number;
  sessionId: number;
  direction: "inbound" | "outbound";
  content: string;
  createdAt: string;
}

export interface SessionRecord {
  id: number;
  channel: ChannelName;
  senderId: string;
  createdAt: string;
  updatedAt: string;
}

export interface InboundMessage {
  channel: ChannelName;
  senderId: string;
  content: string;
  reply: (content: string) => Promise<void>;
}
