import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { GnamiConfig } from "./config.js";
import { BASIC_MEMORY_PATH, DATA_DIR, MEMORY_ENTITY_LOCK_PATH } from "../utils/paths.js";
import { resolveRuntimeEnvVar } from "./env.js";

interface Mem0Record {
  memory?: string;
  text?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

interface BasicMemoryUser {
  notes: string[];
  skills: Record<string, string>;
}

interface BasicMemoryStore {
  users: Record<string, BasicMemoryUser>;
}

const EMPTY_STORE: BasicMemoryStore = { users: {} };

export interface MemoryWriteResult {
  backend: "mem0" | "basic";
}

export class MemoryService {
  constructor(private readonly config: GnamiConfig) {}

  private get mem0Key(): string | null {
    return resolveRuntimeEnvVar("MEM0_API_KEY") ?? this.config.memory.mem0ApiKey ?? null;
  }

  // If MEM0_API_KEY exists, use Mem0 directly; otherwise fall back to local basic memory.
  private get mem0Enabled(): boolean {
    return Boolean(this.mem0Key);
  }

  private get mem0BaseUrl(): string {
    return this.config.memory.mem0BaseUrl ?? "https://api.mem0.ai";
  }

  private authHeaders(): Record<string, string> {
    const key = this.mem0Key;
    if (!key) {
      throw new Error("MEM0 key missing. Set MEM0_API_KEY in .env.");
    }
    return {
      Authorization: `Token ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    };
  }

  private optionalScopeIds(): { org_id?: string; project_id?: string } {
    const org = resolveRuntimeEnvVar("MEM0_ORG_ID") ?? undefined;
    const project = resolveRuntimeEnvVar("MEM0_PROJECT_ID") ?? undefined;
    return {
      ...(org ? { org_id: org } : {}),
      ...(project ? { project_id: project } : {})
    };
  }

  private mem0Url(path: string): string {
    const url = new URL(path, this.mem0BaseUrl.endsWith("/") ? this.mem0BaseUrl : `${this.mem0BaseUrl}/`);
    const scope = this.optionalScopeIds();
    if (scope.org_id) url.searchParams.set("org_id", scope.org_id);
    if (scope.project_id) url.searchParams.set("project_id", scope.project_id);
    return url.toString();
  }

  private optionalOwnerScopeIds(): {
    agent_id?: string;
    app_id?: string;
    run_id?: string;
  } {
    const agent = resolveRuntimeEnvVar("MEM0_AGENT_ID") ?? undefined;
    const app = resolveRuntimeEnvVar("MEM0_APP_ID") ?? undefined;
    const run = resolveRuntimeEnvVar("MEM0_RUN_ID") ?? undefined;
    return {
      ...(agent ? { agent_id: agent } : {}),
      ...(app ? { app_id: app } : {}),
      ...(run ? { run_id: run } : {})
    };
  }

  private configuredEntity(): string | null {
    const fixedEntity =
      resolveRuntimeEnvVar("MEM0_ENTITY") ??
      resolveRuntimeEnvVar("MEM0_ENTITY_NAME") ??
      this.config.memory.entityName;
    if (fixedEntity && fixedEntity.trim().length > 0) {
      return fixedEntity.trim();
    }
    return null;
  }

  private async userId(sessionUserId: string): Promise<string> {
    await mkdir(DATA_DIR, { recursive: true });
    const configured = this.configuredEntity();
    try {
      const locked = (await readFile(MEMORY_ENTITY_LOCK_PATH, "utf-8")).trim();
      if (locked.length > 0) {
        return locked;
      }
    } catch {
      // no lock yet
    }
    if (configured) {
      await writeFile(MEMORY_ENTITY_LOCK_PATH, configured, "utf-8");
      return configured;
    }
    const prefix = this.config.memory.userIdPrefix ?? "gnamiai";
    const fallback = `${prefix}:${sessionUserId}`;
    // Lock fallback too, to avoid creating multiple entities over time.
    await writeFile(MEMORY_ENTITY_LOCK_PATH, fallback, "utf-8");
    return fallback;
  }

  private async loadBasicStore(): Promise<BasicMemoryStore> {
    await mkdir(DATA_DIR, { recursive: true });
    try {
      const raw = await readFile(BASIC_MEMORY_PATH, "utf-8");
      const parsed = JSON.parse(raw) as BasicMemoryStore;
      return parsed?.users ? parsed : EMPTY_STORE;
    } catch {
      return EMPTY_STORE;
    }
  }

  private async saveBasicStore(store: BasicMemoryStore): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(BASIC_MEMORY_PATH, JSON.stringify(store, null, 2), "utf-8");
  }

  private async withBasicUser(sessionUserId: string): Promise<[BasicMemoryStore, BasicMemoryUser, string]> {
    const userId = await this.userId(sessionUserId);
    const store = await this.loadBasicStore();
    if (!store.users[userId]) {
      store.users[userId] = { notes: [], skills: {} };
    }
    return [store, store.users[userId], userId];
  }

  private async mem0Search(userId: string, query: string): Promise<Mem0Record[]> {
    if (!this.mem0Enabled) return [];
    const response = await fetch(this.mem0Url("/v1/memories/search/"), {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({
        query,
        user_id: userId,
        version: "v2",
        output_format: "v1.1",
        filters: { user_id: userId },
        top_k: 8,
        ...this.optionalOwnerScopeIds(),
        ...this.optionalScopeIds()
      })
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { memories?: Mem0Record[]; results?: Mem0Record[] };
    return json.memories ?? json.results ?? [];
  }

  private recordsToText(records: Mem0Record[], limit = 10): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const record of records) {
      const text = (record.memory ?? record.text ?? record.content ?? "").trim();
      if (!text) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      out.push(text);
      if (out.length >= limit) break;
    }
    return out;
  }

  private async mem0Add(
    userId: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.mem0Enabled) return;
    const basePayload = {
      user_id: userId,
      messages,
      version: "v2",
      output_format: "v1.1",
      metadata: metadata ?? {},
      ...this.optionalOwnerScopeIds(),
      ...this.optionalScopeIds()
    };

    const candidates: Array<Record<string, unknown>> = [
      basePayload,
      // Compatibility payload: some deployments reject explicit version/output_format.
      {
        user_id: userId,
        messages,
        metadata: metadata ?? {},
        ...this.optionalOwnerScopeIds(),
        ...this.optionalScopeIds()
      },
      // Minimal payload expected by older/strict validators.
      {
        user_id: userId,
        messages
      },
      // Fallback with explicit agent_id.
      {
        user_id: userId,
        agent_id: "gnamiai",
        messages
      }
    ];

    const errors: string[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const payload = candidates[i];
      const response = await fetch(this.mem0Url("/v1/memories/"), {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        return;
      }
      const body = (await response.text()).slice(0, 800);
      errors.push(`attempt${i + 1}:${response.status}:${body}`);
    }

    const scope = this.optionalScopeIds();
    const hint = `scope(org=${scope.org_id ?? "none"},project=${scope.project_id ?? "none"})`;
    throw new Error(`Mem0 write failed (400) ${hint}: ${errors.join(" | ")}`);
  }

  private async basicGetContext(sessionUserId: string): Promise<string> {
    const [, user] = await this.withBasicUser(sessionUserId);
    const notes = user.notes.slice(-8);
    if (notes.length === 0) return "";
    return notes.map((entry, index) => `${index + 1}. ${entry}`).join("\n");
  }

  private async basicAddConversation(
    sessionUserId: string,
    userContent: string,
    assistantContent: string
  ): Promise<void> {
    const [store, user] = await this.withBasicUser(sessionUserId);
    const note = `User: ${userContent.slice(0, 280)} | Assistant: ${assistantContent.slice(0, 280)}`;
    user.notes.push(note);
    if (user.notes.length > 120) {
      user.notes = user.notes.slice(-120);
    }
    await this.saveBasicStore(store);
  }

  private async basicAddSkill(sessionUserId: string, skillName: string, skillContent: string): Promise<void> {
    const [store, user] = await this.withBasicUser(sessionUserId);
    user.skills[skillName] = skillContent;
    await this.saveBasicStore(store);
  }

  private async basicFindSkill(sessionUserId: string, skillName: string): Promise<string | null> {
    const [, user] = await this.withBasicUser(sessionUserId);
    return user.skills[skillName] ?? null;
  }

  async getContext(
    sessionUserId: string,
    latestUserInput: string,
    recentConversationHint = ""
  ): Promise<string> {
    const userId = await this.userId(sessionUserId);
    const basicContext = await this.basicGetContext(sessionUserId);
    if (this.mem0Enabled) {
      const queries = [
        latestUserInput,
        recentConversationHint,
        "Important user preferences, identity, goals, current projects, and prior completed work",
        "What has this user done before with GnamiAI?"
      ]
        .map((value) => value.trim())
        .filter(Boolean);

      const collected: Mem0Record[] = [];
      for (const query of queries.slice(0, 4)) {
        const records = await this.mem0Search(userId, query);
        collected.push(...records);
      }
      const texts = this.recordsToText(collected, 10);
      if (texts.length > 0 && basicContext) {
        return [
          "Mem0 context:",
          ...texts.map((entry, index) => `${index + 1}. ${entry}`),
          "",
          "Local timeline memory:",
          basicContext
        ].join("\n");
      }
      if (texts.length > 0) {
        return texts.map((entry, index) => `${index + 1}. ${entry}`).join("\n");
      }
      return basicContext;
    }
    return basicContext;
  }

  async addConversationMemory(
    sessionUserId: string,
    userContent: string,
    assistantContent: string
  ): Promise<MemoryWriteResult> {
    const userId = await this.userId(sessionUserId);
    if (this.mem0Enabled) {
      await this.mem0Add(userId, [
        { role: "user", content: userContent },
        { role: "assistant", content: assistantContent }
      ]);
      return { backend: "mem0" };
    }
    await this.basicAddConversation(sessionUserId, userContent, assistantContent);
    return { backend: "basic" };
  }

  async addSkillMemory(
    sessionUserId: string,
    skillName: string,
    skillContent: string
  ): Promise<MemoryWriteResult> {
    const userId = await this.userId(sessionUserId);
    if (this.mem0Enabled) {
      await this.mem0Add(
        userId,
        [
          {
            role: "user",
            content: `Installed skill "${skillName}".`
          },
          {
            role: "assistant",
            content: `SKILL:${skillName}\n${skillContent}`
          }
        ],
        { type: "skill", skillName }
      );
      return { backend: "mem0" };
    }
    await this.basicAddSkill(sessionUserId, skillName, skillContent);
    return { backend: "basic" };
  }

  async findSkill(sessionUserId: string, skillName: string): Promise<string | null> {
    if (this.mem0Enabled) {
      const userId = await this.userId(sessionUserId);
      const records = await this.mem0Search(userId, `SKILL:${skillName}`);
      for (const record of records) {
        const text = (record.memory ?? record.text ?? record.content ?? "").trim();
        if (!text) continue;
        if (text.includes(`SKILL:${skillName}`)) {
          return text.replace(new RegExp(`^.*SKILL:${skillName}\\s*`, "s"), "").trim() || null;
        }
      }
      return null;
    }
    return await this.basicFindSkill(sessionUserId, skillName);
  }
}
