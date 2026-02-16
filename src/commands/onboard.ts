import { confirm, input, password, select } from "@inquirer/prompts";
import { ensureConfig, saveConfig } from "../core/config.js";
import { configureOpenAiCodexOauth, runCodexOauthLogin } from "../core/codex-oauth.js";
import { upsertEnvVar } from "../core/env.js";

function normalize(value: string): string {
  return value.replace(/[\s"'`]+/g, "");
}

function extractUrls(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s"'<>]+/gi);
  return matches ?? [];
}

function parseUrlSafe(value: string): URL | null {
  try {
    return new URL(value.replace(/[.,;:!?]+$/g, ""));
  } catch {
    return null;
  }
}

function confirmMatches(pasted: string, expected: string): boolean {
  const cleanPasted = normalize(pasted);
  const cleanExpected = normalize(expected);
  if (cleanPasted === cleanExpected || cleanPasted.includes(cleanExpected)) {
    return true;
  }
  if (
    cleanPasted.includes("localhost:1455/success") &&
    cleanPasted.includes("id_token=")
  ) {
    return true;
  }

  const expectedUrl = parseUrlSafe(expected);
  const expectedState = expectedUrl?.searchParams.get("state") ?? null;
  const expectedCode = expectedUrl?.searchParams.get("code") ?? null;

  for (const candidate of extractUrls(pasted)) {
    const url = parseUrlSafe(candidate);
    if (!url) {
      continue;
    }
    if (normalize(url.toString()) === cleanExpected) {
      return true;
    }
    if (expectedState && url.searchParams.get("state") === expectedState) {
      return true;
    }
    if (expectedCode && url.searchParams.get("code") === expectedCode) {
      return true;
    }
  }

  return false;
}

export async function runOnboard(installDaemon: boolean): Promise<void> {
  const config = await ensureConfig();

  const modelProvider = await select({
    message: "Select model provider",
    choices: [
      { name: "OpenAI", value: "openai" },
      { name: "Local model (Ollama/OpenAI-compatible)", value: "local" }
    ]
  });

  const model = await input({
    message: "Model name",
    default: modelProvider === "openai" ? "gpt-5.3-codex" : "llama3.1"
  });

  if (modelProvider === "openai") {
    const authMethod = await select({
      message: "OpenAI authentication",
      choices: [
        { name: "ChatGPT/Codex OAuth (recommended)", value: "oauth" },
        { name: "Manual API key", value: "api_key" }
      ]
    });
    if (authMethod === "oauth") {
      process.stdout.write("Running Codex OAuth login...\n");
      const oauthUrl = await runCodexOauthLogin();
      if (oauthUrl) {
        const pasted = await input({
          message: "Paste the OAuth URL shown above to confirm",
          validate(value) {
            return confirmMatches(value, oauthUrl)
              ? true
              : "URL does not match the detected OAuth link.";
          }
        });
        if (!confirmMatches(pasted, oauthUrl)) {
          throw new Error("OAuth link confirmation failed.");
        }
      }
      await configureOpenAiCodexOauth();
      config.agent.openaiAuthMode = "codex_oauth";
      config.agent.openaiApiKey = undefined;
    } else {
      config.agent.openaiApiKey = await password({
        message: "OpenAI API key",
        mask: "*"
      });
      config.agent.openaiAuthMode = "api_key";
    }
  } else {
    const localBaseUrl = await input({
      message: "Local model base URL",
      default: config.agent.localBaseUrl ?? "http://127.0.0.1:11434/v1"
    });
    config.agent.localBaseUrl = localBaseUrl.trim() || "http://127.0.0.1:11434/v1";
    if (
      await confirm({
        message: "Set local model API key?",
        default: Boolean(config.agent.localApiKey)
      })
    ) {
      config.agent.localApiKey = await password({
        message: "Local model API key",
        mask: "*"
      });
    }
  }
  config.agent.model = `${modelProvider}/${model}`;
  if (modelProvider === "openai") {
    config.agent.openaiFallbackModel = "gpt-5.2-codex";
  }

  config.gateway.port = Number(
    await input({
      message: "Gateway port",
      default: String(config.gateway.port ?? 18789),
      validate(value) {
        const port = Number(value);
        return Number.isInteger(port) && port > 0 && port < 65536
          ? true
          : "Port must be a number between 1 and 65535";
      }
    })
  );

  if (
    await confirm({
      message: "Set gateway auth token?",
      default: Boolean(config.gateway.authToken)
    })
  ) {
    config.gateway.authToken = await password({
      message: "Gateway auth token (min 8 chars)",
      mask: "*",
      validate(value) {
        return value.length >= 8 ? true : "Token must be at least 8 characters";
      }
    });
  }

  if (
    await confirm({
      message: "Enable Telegram channel?",
      default: Boolean(config.channels.telegram)
    })
  ) {
    config.channels.telegram = {
      botToken: await password({ message: "Telegram bot token", mask: "*" }),
      pollingIntervalMs: 2500
    };
  }

  if (
    await confirm({
      message: "Enable external memory (Mem0)?",
      default: config.memory.provider === "mem0" && config.memory.enabled
    })
  ) {
    config.memory.enabled = true;
    config.memory.provider = "mem0";
    const mem0Key = await password({
      message: "Mem0 API key",
      mask: "*"
    });
    await upsertEnvVar("MEM0_API_KEY", mem0Key);
    config.memory.mem0ApiKey = undefined;
  }

  await saveConfig(config);
  process.stdout.write(`Saved config at ~/.gnamiai/gnamiai.json\n`);
  if (installDaemon) {
    process.stdout.write(
      "Daemon auto-install is not yet implemented. Use OS service manager to run `gnamiai gateway`.\n"
    );
  }
}
