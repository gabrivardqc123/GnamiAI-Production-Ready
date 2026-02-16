import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GNAMI_HOME } from "../utils/paths.js";

export const WORKSPACE_DIR = join(GNAMI_HOME, "workspace");

const DOC_TEMPLATES: Record<string, string> = {
  "AGENTS.md": "# AGENTS\n\nPrimary objective: be a reliable, practical personal assistant.\n",
  "SOUL.md":
    "# SOUL\n\nYou are GnamiBot.\nYou are the user's personal, local-first assistant.\nYour identity is stable: concise, pragmatic, action-oriented, and technically rigorous.\nNever claim to be generic or anonymous.\n",
  "MEMORY.md":
    "# MEMORY\n\nCore persistent facts:\n- Assistant name: GnamiBot\n- Role: personal local-first AI assistant\n\nAdd user preferences and durable facts below.\n",
  "TOOLS.md": "# TOOLS\n\nDocument preferred tools and operating procedures.\n"
};

const LEGACY_DOC_TEMPLATES: Record<string, string> = {
  "AGENTS.md": "# AGENTS\n\nDefine assistant behavior, goals, and boundaries.\n",
  "SOUL.md": "# SOUL\n\nDefine identity, tone, and long-term personality.\n",
  "MEMORY.md": "# MEMORY\n\nStore durable user preferences and recurring facts.\n",
  "TOOLS.md": "# TOOLS\n\nDocument preferred tools and operating procedures.\n"
};

const DOC_NAME_MAP = new Map(
  Object.keys(DOC_TEMPLATES).map((name) => [name.toUpperCase(), name] as const)
);

function normalizeDocName(name: string): string {
  const normalized = name.trim().toUpperCase();
  const canonical = DOC_NAME_MAP.get(normalized);
  if (!canonical) {
    throw new Error(`Unsupported workspace doc: ${name}`);
  }
  return canonical;
}

export async function ensureWorkspaceDocs(): Promise<void> {
  await mkdir(WORKSPACE_DIR, { recursive: true });
  for (const [name, template] of Object.entries(DOC_TEMPLATES)) {
    const path = join(WORKSPACE_DIR, name);
    try {
      const existing = await readFile(path, "utf-8");
      const legacy = LEGACY_DOC_TEMPLATES[name];
      if (legacy && existing.trim() === legacy.trim()) {
        await writeFile(path, template, "utf-8");
      }
    } catch {
      await writeFile(path, template, "utf-8");
    }
  }
}

export async function readWorkspaceDoc(name: string): Promise<string> {
  await ensureWorkspaceDocs();
  const normalized = normalizeDocName(name);
  return await readFile(join(WORKSPACE_DIR, normalized), "utf-8");
}

export async function writeWorkspaceDoc(name: string, content: string): Promise<void> {
  await ensureWorkspaceDocs();
  const normalized = normalizeDocName(name);
  await writeFile(join(WORKSPACE_DIR, normalized), content, "utf-8");
}

export async function readWorkspaceDocs(): Promise<Record<string, string>> {
  await ensureWorkspaceDocs();
  const docs = await Promise.all(
    Object.keys(DOC_TEMPLATES).map(async (name) => [name, await readWorkspaceDoc(name)] as const)
  );
  return Object.fromEntries(docs);
}

export async function buildWorkspaceContext(): Promise<string> {
  const docs = await readWorkspaceDocs();
  const ordered = ["AGENTS.md", "SOUL.md", "MEMORY.md", "TOOLS.md"];
  return [
    `Core identity: You are ${resolveAssistantNameFromDocs(docs, "GnamiBot")}, the user's personal assistant.`,
    ordered.map((name) => `## ${name}\n${docs[name]}`).join("\n\n")
  ].join("\n\n");
}

function resolveAssistantNameFromDocs(
  docs: Record<string, string>,
  fallback = "GnamiBot"
): string {
  const memory = docs["MEMORY.md"] ?? "";
  const soul = docs["SOUL.md"] ?? "";

  const explicit = memory.match(/assistant\s*name\s*:\s*([^\n\r]+)/i)?.[1]?.trim();
  if (explicit) return explicit;

  const soulName = soul.match(/you are\s+([a-z0-9_-]+)/i)?.[1]?.trim();
  if (soulName) return soulName;

  return fallback;
}

export async function resolveAssistantName(fallback = "GnamiBot"): Promise<string> {
  const docs = await readWorkspaceDocs();
  return resolveAssistantNameFromDocs(docs, fallback);
}
