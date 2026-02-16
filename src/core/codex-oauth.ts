import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureConfig, saveConfig } from "./config.js";

const AUTH_FILE = "auth.json";

function codexHomePath(): string {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

function commandName(base: string): string {
  return process.platform === "win32" ? `${base}.cmd` : base;
}

function sanitizeUrl(value: string): string {
  return value.replace(/[.,;:!?]+$/g, "");
}

export function findAuthAuthorizeUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s"'<>]+/gi);
  if (!matches) {
    return null;
  }
  for (const raw of matches) {
    const candidate = sanitizeUrl(raw);
    try {
      const url = new URL(candidate);
      if (url.hostname === "auth.openai.com" && url.pathname.includes("/oauth/authorize")) {
        return url.toString();
      }
    } catch {
      // ignore invalid candidate
    }
  }
  return null;
}

async function runCommandWithAuthUrlCapture(
  command: string,
  args: string[]
): Promise<string | null> {
  return await new Promise<string | null>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["inherit", "pipe", "pipe"],
      env: process.env,
      shell: process.platform === "win32"
    });
    let foundAuthUrl: string | null = null;

    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      process.stdout.write(text);
      if (!foundAuthUrl) {
        foundAuthUrl = findAuthAuthorizeUrl(text);
      }
    };
    const onErrChunk = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      process.stderr.write(text);
      if (!foundAuthUrl) {
        foundAuthUrl = findAuthAuthorizeUrl(text);
      }
    };

    child.stdout.on("data", onChunk);
    child.stderr.on("data", onErrChunk);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(foundAuthUrl);
      } else {
        reject(new Error(`Command failed: ${command} ${args.join(" ")}`));
      }
    });
  });
}

export async function runCodexOauthLogin(): Promise<string | null> {
  const attempts: Array<{ cmd: string; args: string[] }> = [
    { cmd: "codex", args: ["login"] },
    { cmd: commandName("npx"), args: ["-y", "@openai/codex", "login"] }
  ];

  let lastError: Error | null = null;
  let capturedAuthUrl: string | null = null;
  for (const attempt of attempts) {
    try {
      capturedAuthUrl = await runCommandWithAuthUrlCapture(attempt.cmd, attempt.args);
      if (capturedAuthUrl) {
        process.stdout.write(`\nOAuth link (confirm in browser): ${capturedAuthUrl}\n`);
      } else {
        process.stdout.write(
          "\nOAuth link was not auto-detected. Copy the auth.openai.com/oauth/authorize URL shown above.\n"
        );
      }
      return capturedAuthUrl;
    } catch (error) {
      lastError = error as Error;
    }
  }
  throw new Error(
    `Unable to run Codex OAuth login. Install Codex CLI and run 'codex login'. ${lastError?.message ?? ""}`
  );
}

export async function configureOpenAiCodexOauth(): Promise<string> {
  const authPath = join(codexHomePath(), AUTH_FILE);
  const raw = await readFile(authPath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  if (!("tokens" in parsed) || !parsed.tokens) {
    throw new Error(`Codex auth file is missing OAuth tokens: ${authPath}`);
  }

  const config = await ensureConfig();
  config.agent.model = "openai/gpt-5.3-codex";
  config.agent.openaiFallbackModel = "gpt-5.2-codex";
  config.agent.openaiAuthMode = "codex_oauth";
  await saveConfig(config);
  return authPath;
}
