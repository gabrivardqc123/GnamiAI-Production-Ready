import { access } from "node:fs/promises";
import { constants } from "node:fs";
import process from "node:process";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureConfig } from "../core/config.js";
import { CONFIG_PATH } from "../utils/paths.js";
import { resolveRuntimeEnvVar } from "../core/env.js";

export async function runDoctor(): Promise<void> {
  const issues: string[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0] ?? "0");
  if (nodeMajor < 22) {
    issues.push(`Node version ${process.versions.node} detected. Require >=22.`);
  }

  const config = await ensureConfig();
  if (!config.agent.model.includes("/")) {
    issues.push("agent.model must be in provider/model format.");
  }

  if (config.agent.model.startsWith("openai/")) {
    if (config.agent.openaiAuthMode === "codex_oauth") {
      const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
      const authPath = join(codexHome, "auth.json");
      try {
        await access(authPath, constants.R_OK);
      } catch {
        issues.push(`Codex OAuth mode selected but auth file missing: ${authPath}. Run: gnamiai oauth codex`);
      }
    } else if (!config.agent.openaiApiKey && !process.env.OPENAI_API_KEY) {
      issues.push(
        "OpenAI api_key mode selected but API key is missing. Run: gnamiai oauth codex or set openaiApiKey."
      );
    }
  }

  if (config.memory.enabled) {
    const mem0 = resolveRuntimeEnvVar("MEM0_API_KEY");
    if (!mem0) {
      issues.push("MEM0_API_KEY not found in .env/.env.example/runtime env; memory will run in basic mode.");
    }
  }

  if (config.agent.model.startsWith("local/")) {
    const base =
      config.agent.localBaseUrl ?? process.env.LOCAL_MODEL_BASE_URL ?? "http://127.0.0.1:11434/v1";
    if (!base.startsWith("http://") && !base.startsWith("https://")) {
      issues.push("Local model base URL must start with http:// or https://.");
    }
  }

  try {
    await access(CONFIG_PATH, constants.R_OK | constants.W_OK);
  } catch {
    issues.push(`Config is not readable/writable: ${CONFIG_PATH}`);
  }

  if (issues.length === 0) {
    process.stdout.write("Doctor passed. Configuration is healthy.\n");
    return;
  }

  process.stdout.write("Doctor found issues:\n");
  for (const issue of issues) {
    process.stdout.write(`- ${issue}\n`);
  }
  process.exitCode = 1;
}
