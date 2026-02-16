import { ensureConfig } from "../core/config.js";
import type { ChannelName } from "../types.js";

export async function runMessageSend(
  to: string,
  message: string,
  channel: ChannelName = "webchat"
): Promise<void> {
  const config = await ensureConfig();
  const port = config.gateway.port ?? 18789;
  const response = await fetch(`http://127.0.0.1:${port}/api/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.gateway.authToken ? { "x-gnamiai-token": config.gateway.authToken } : {})
    },
    body: JSON.stringify({ to, message, channel })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gateway send failed (${response.status}): ${body}`);
  }
  process.stdout.write("Message sent.\n");
}

