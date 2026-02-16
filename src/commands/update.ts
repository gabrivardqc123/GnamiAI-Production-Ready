import { ensureConfig, saveConfig } from "../core/config.js";

export async function runUpdate(channel: "stable" | "beta" | "dev"): Promise<void> {
  const config = await ensureConfig();
  const modelByChannel = {
    stable: "openai/gpt-5.3-codex",
    beta: "openai/gpt-5.2-codex",
    dev: "local/llama3.1"
  } as const;
  config.agent.model = modelByChannel[channel];
  if (channel === "stable") {
    config.agent.openaiFallbackModel = "gpt-5.2-codex";
    config.agent.openaiAuthMode = "codex_oauth";
  }
  if (channel === "beta") {
    config.agent.openaiAuthMode = "codex_oauth";
  }
  await saveConfig(config);
  process.stdout.write(`Updated channel to ${channel}. model=${config.agent.model}\n`);
}
