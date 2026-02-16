import type { InboundMessage } from "../types.js";

interface TelegramConfig {
  botToken: string;
  pollingIntervalMs: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id: number };
  };
}

type MessageHandler = (message: InboundMessage) => Promise<void>;

export class TelegramChannel {
  private offset = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: TelegramConfig,
    private readonly onMessage: MessageHandler
  ) {}

  start(): void {
    this.poll().catch(() => undefined);
    this.timer = setInterval(() => {
      this.poll().catch(() => undefined);
    }, this.config.pollingIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async send(chatId: string, text: string): Promise<void> {
    await this.callTelegram("sendMessage", {
      chat_id: chatId,
      text
    });
  }

  private async poll(): Promise<void> {
    const response = await this.callTelegram("getUpdates", {
      timeout: 0,
      offset: this.offset,
      allowed_updates: ["message"]
    });
    const updates = (response.result ?? []) as TelegramUpdate[];
    for (const update of updates) {
      this.offset = update.update_id + 1;
      const text = update.message?.text?.trim();
      const chatId = update.message?.chat?.id;
      if (!text || chatId === undefined) {
        continue;
      }
      await this.onMessage({
        channel: "telegram",
        senderId: String(chatId),
        content: text,
        reply: async (content: string) => {
          await this.send(String(chatId), content);
        }
      });
    }
  }

  private async callTelegram(
    method: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.config.botToken}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error (${response.status}): ${body}`);
    }
    const json = (await response.json()) as Record<string, unknown>;
    if (json.ok !== true) {
      throw new Error(`Telegram API returned failure for method "${method}".`);
    }
    return json;
  }
}

