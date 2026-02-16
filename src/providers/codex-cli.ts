import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

function commandName(base: string): string {
  return process.platform === "win32" ? `${base}.cmd` : base;
}

async function run(command: string, args: string[], stdinInput?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      shell: process.platform === "win32"
    });
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk.toString("utf-8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stderr += text;
      process.stderr.write(text);
    });
    if (stdinInput !== undefined) {
      child.stdin.write(stdinInput);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `Command failed: ${command} ${args.join(" ")}`));
      }
    });
  });
}

export async function runCodexExec(model: string, prompt: string): Promise<string> {
  const outputFile = join(tmpdir(), `gnamiai-codex-${randomUUID()}.txt`);
  const attempts: Array<{ cmd: string; args: string[] }> = [
    {
      cmd: "codex",
      args: [
        "exec",
        "-m",
        model,
        "--skip-git-repo-check",
        "--output-last-message",
        outputFile,
        "-"
      ]
    },
    {
      cmd: commandName("npx"),
      args: [
        "-y",
        "@openai/codex",
        "exec",
        "-m",
        model,
        "--skip-git-repo-check",
        "--output-last-message",
        outputFile,
        "-"
      ]
    }
  ];

  let lastError: Error | null = null;
  try {
    for (const attempt of attempts) {
      try {
        await run(attempt.cmd, attempt.args, prompt);
        const output = (await readFile(outputFile, "utf-8")).trim();
        if (!output) {
          throw new Error("Codex exec returned empty output.");
        }
        return output;
      } catch (error) {
        lastError = error as Error;
      }
    }
  } finally {
    await rm(outputFile, { force: true }).catch(() => undefined);
  }

  throw lastError ?? new Error("Codex exec failed.");
}
