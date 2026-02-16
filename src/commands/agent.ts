import { ensureConfig } from "../core/config.js";
import { AgentRuntime } from "../providers/agent.js";

export async function runAgent(message: string, thinking: "low" | "medium" | "high") {
  const config = await ensureConfig();
  const agent = new AgentRuntime(config);
  const reply = await agent.respond({
    input: message,
    history: [],
    thinking
  });
  process.stdout.write(`${reply}\n`);
}

