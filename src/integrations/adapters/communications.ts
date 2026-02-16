import { platform } from "node:os";
import { BaseAdapter } from "../base.js";
import { asOptionalString, asString, execShell, httpJson } from "../helpers.js";

export class WhatsAppAdapter extends BaseAdapter {
  readonly name = "whatsapp" as const;

  private get accessToken(): string | undefined {
    return asOptionalString(this.config?.accessToken);
  }
  private get phoneNumberId(): string | undefined {
    return asOptionalString(this.config?.phoneNumberId);
  }
  private get baseUrl(): string {
    return asOptionalString(this.config?.baseUrl) ?? "https://graph.facebook.com/v22.0";
  }

  isConfigured(): boolean {
    return Boolean(this.accessToken && this.phoneNumberId);
  }

  async healthCheck() {
    if (!this.isConfigured()) {
      return { ok: false, details: "Missing accessToken or phoneNumberId." };
    }
    const url = `${this.baseUrl}/${this.phoneNumberId}?fields=id`;
    await httpJson(url, {
      headers: { Authorization: `Bearer ${this.accessToken ?? ""}` }
    });
    return { ok: true, details: "WhatsApp Cloud API reachable." };
  }

  async execute(action: string, params: Record<string, unknown>) {
    if (action !== "send_message") {
      throw new Error(`Unsupported whatsapp action "${action}". Use send_message.`);
    }
    if (!this.isConfigured()) {
      throw new Error("WhatsApp is not configured.");
    }
    const to = asString(params.to, "to");
    const text = asString(params.text, "text");
    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`;
    return await httpJson(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken ?? ""}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text }
      })
    });
  }
}

export class TelegramAdapter extends BaseAdapter {
  readonly name = "telegram" as const;
  private get botToken(): string | undefined {
    return asOptionalString(this.config?.botToken);
  }
  private get baseUrl(): string {
    const token = this.botToken;
    return `https://api.telegram.org/bot${token ?? "missing"}`;
  }

  isConfigured(): boolean {
    return Boolean(this.botToken);
  }

  async healthCheck() {
    if (!this.isConfigured()) return { ok: false, details: "Missing botToken." };
    await httpJson(`${this.baseUrl}/getMe`);
    return { ok: true, details: "Telegram bot token is valid." };
  }

  async execute(action: string, params: Record<string, unknown>) {
    if (action !== "send_message") {
      throw new Error(`Unsupported telegram action "${action}". Use send_message.`);
    }
    const chatId = asString(params.chat_id ?? params.to, "chat_id");
    const text = asString(params.text, "text");
    return await httpJson(`${this.baseUrl}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  }
}

export class DiscordAdapter extends BaseAdapter {
  readonly name = "discord" as const;
  private get botToken(): string | undefined {
    return asOptionalString(this.config?.botToken);
  }
  private get defaultChannelId(): string | undefined {
    return asOptionalString(this.config?.defaultChannelId);
  }

  isConfigured(): boolean {
    return Boolean(this.botToken);
  }

  async healthCheck() {
    if (!this.isConfigured()) return { ok: false, details: "Missing botToken." };
    await httpJson("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${this.botToken ?? ""}` }
    });
    return { ok: true, details: "Discord bot token is valid." };
  }

  async execute(action: string, params: Record<string, unknown>) {
    if (action !== "send_message") {
      throw new Error(`Unsupported discord action "${action}". Use send_message.`);
    }
    const channelId = asString(params.channelId ?? params.to ?? this.defaultChannelId, "channelId");
    const content = asString(params.text ?? params.content, "text");
    return await httpJson(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${this.botToken ?? ""}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content })
    });
  }
}

export class SlackAdapter extends BaseAdapter {
  readonly name = "slack" as const;
  private get botToken(): string | undefined {
    return asOptionalString(this.config?.botToken);
  }
  private get defaultChannel(): string | undefined {
    return asOptionalString(this.config?.defaultChannel);
  }

  isConfigured(): boolean {
    return Boolean(this.botToken);
  }

  async healthCheck() {
    if (!this.isConfigured()) return { ok: false, details: "Missing botToken." };
    const response = await httpJson<{ ok: boolean; error?: string }>("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.botToken ?? ""}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "pretty=1"
    });
    if (!response.ok) {
      throw new Error(`Slack auth failed: ${response.error ?? "unknown error"}`);
    }
    return { ok: true, details: "Slack token is valid." };
  }

  async execute(action: string, params: Record<string, unknown>) {
    if (action !== "send_message") {
      throw new Error(`Unsupported slack action "${action}". Use send_message.`);
    }
    const channel = asString(params.channel ?? params.to ?? this.defaultChannel, "channel");
    const text = asString(params.text, "text");
    const response = await httpJson<{ ok: boolean; error?: string }>(
      "https://slack.com/api/chat.postMessage",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.botToken ?? ""}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ channel, text })
      }
    );
    if (!response.ok) {
      throw new Error(`Slack API failed: ${response.error ?? "unknown error"}`);
    }
    return response;
  }
}

export class SignalAdapter extends BaseAdapter {
  readonly name = "signal" as const;
  private get signalCliPath(): string {
    return asOptionalString(this.config?.signalCliPath) ?? "signal-cli";
  }
  private get accountNumber(): string | undefined {
    return asOptionalString(this.config?.accountNumber);
  }

  isConfigured(): boolean {
    return Boolean(this.accountNumber);
  }

  async healthCheck() {
    if (!this.isConfigured()) return { ok: false, details: "Missing accountNumber." };
    await execShell(this.signalCliPath, ["-v"], 15000);
    return { ok: true, details: "signal-cli is available." };
  }

  async execute(action: string, params: Record<string, unknown>) {
    if (action !== "send_message") {
      throw new Error(`Unsupported signal action "${action}". Use send_message.`);
    }
    const account = asString(this.accountNumber, "accountNumber");
    const target = asString(params.to, "to");
    const text = asString(params.text, "text");
    const output = await execShell(
      this.signalCliPath,
      ["-a", account, "send", "-m", text, target],
      60000
    );
    return { ok: true, output };
  }
}

export class IMessageAdapter extends BaseAdapter {
  readonly name = "imessage" as const;
  private get senderAccount(): string | undefined {
    return asOptionalString(this.config?.senderAccount);
  }

  isConfigured(): boolean {
    return platform() === "darwin";
  }

  async healthCheck() {
    if (platform() !== "darwin") {
      return { ok: false, details: "iMessage adapter requires macOS." };
    }
    await execShell("osascript", ["-e", 'return "ok"'], 10000);
    return { ok: true, details: "osascript is available for iMessage." };
  }

  async execute(action: string, params: Record<string, unknown>) {
    if (platform() !== "darwin") {
      throw new Error("iMessage adapter requires macOS.");
    }
    if (action !== "send_message") {
      throw new Error(`Unsupported imessage action "${action}". Use send_message.`);
    }
    const recipient = asString(params.to, "to");
    const text = asString(params.text, "text").replace(/"/g, '\\"');
    const account = this.senderAccount;
    const serviceSelector = account
      ? `first service whose service type = iMessage and account id = "${account}"`
      : `first service whose service type = iMessage`;
    const script = [
      'tell application "Messages"',
      `set targetService to ${serviceSelector}`,
      `set targetBuddy to buddy "${recipient}" of targetService`,
      `send "${text}" to targetBuddy`,
      "end tell"
    ].join("\n");
    const output = await execShell("osascript", ["-e", script], 20000);
    return { ok: true, output };
  }
}

