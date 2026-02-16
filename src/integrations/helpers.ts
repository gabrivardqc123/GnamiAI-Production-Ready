import { spawn } from "node:child_process";

export function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Expected non-empty string for "${label}".`);
  }
  return value.trim();
}

export function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object for "${label}".`);
  }
  return value as Record<string, unknown>;
}

export async function httpJson<T = Record<string, unknown>>(
  url: string,
  options?: RequestInit,
  expectStatuses: number[] = [200]
): Promise<T> {
  const response = await fetch(url, options);
  if (!expectStatuses.includes(response.status)) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} ${url}: ${body}`);
  }
  return (await response.json()) as T;
}

export function execShell(command: string, args: string[], timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Exit code ${code ?? "unknown"}`));
        return;
      }
      resolve(stdout.trim() || stderr.trim() || "(no output)");
    });
  });
}

