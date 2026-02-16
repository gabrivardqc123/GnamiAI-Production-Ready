import { spawn } from "node:child_process";
import { installSkill } from "./skills.js";
import type { IntegrationName } from "../integrations/types.js";
import type { IntegrationRuntime } from "../integrations/runtime.js";

export type AgentAction =
  | { type: "shell"; command: string; timeoutMs?: number }
  | { type: "install_skill"; name: string; content: string }
  | { type: "integration"; app: IntegrationName; action: string; params?: Record<string, unknown> };

export interface ActionResult {
  action: AgentAction;
  ok: boolean;
  output: string;
}

function safeJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function parseAgentActions(text: string): AgentAction[] {
  const actions: AgentAction[] = [];
  const pattern = /```gnami-action\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(text)) !== null) {
    const payload = safeJsonParse(match[1]?.trim() ?? "");
    if (!payload || typeof payload !== "object") continue;
    const record = payload as Record<string, unknown>;
    if (record.type === "shell" && typeof record.command === "string") {
      actions.push({
        type: "shell",
        command: record.command,
        timeoutMs: typeof record.timeoutMs === "number" ? record.timeoutMs : undefined
      });
    }
    if (
      record.type === "install_skill" &&
      typeof record.name === "string" &&
      typeof record.content === "string"
    ) {
      actions.push({
        type: "install_skill",
        name: record.name,
        content: record.content
      });
    }
    if (
      record.type === "integration" &&
      typeof record.app === "string" &&
      typeof record.action === "string"
    ) {
      actions.push({
        type: "integration",
        app: record.app as IntegrationName,
        action: record.action,
        params:
          record.params && typeof record.params === "object" && !Array.isArray(record.params)
            ? (record.params as Record<string, unknown>)
            : undefined
      });
    }
  }
  return actions;
}

export function stripAgentActions(text: string): string {
  return text.replace(/```gnami-action[\s\S]*?```/g, "").trim();
}

async function execShell(command: string, timeoutMs: number): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, {
      cwd: process.cwd(),
      shell: true,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Shell command timed out after ${timeoutMs}ms`));
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
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      if (code === 0) {
        resolve(output || "(no output)");
      } else {
        reject(new Error(output || `Command failed with exit code ${code ?? "unknown"}`));
      }
    });
  });
}

export async function executeAgentActions(
  actions: AgentAction[],
  options?: { integrations?: IntegrationRuntime }
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const action of actions) {
    try {
      if (action.type === "shell") {
        const output = await execShell(action.command, action.timeoutMs ?? 60000);
        results.push({ action, ok: true, output });
        continue;
      }
      if (action.type === "install_skill") {
        const skillId = await installSkill(action.name, action.content);
        results.push({ action, ok: true, output: `Installed skill: ${skillId}` });
        continue;
      }
      if (action.type === "integration") {
        if (!options?.integrations) {
          throw new Error("Integration runtime is not available.");
        }
        const result = await options.integrations.exec({
          app: action.app,
          action: action.action,
          params: action.params
        });
        results.push({ action, ok: true, output: JSON.stringify(result) });
        continue;
      }
      results.push({ action, ok: false, output: "Unsupported action type." });
    } catch (error) {
      results.push({
        action,
        ok: false,
        output: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return results;
}
