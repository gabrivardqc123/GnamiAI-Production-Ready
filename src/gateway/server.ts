import { join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type { FastifyRequest } from "fastify";
import type pino from "pino";
import { hostname, platform, release } from "node:os";
import { Store } from "../core/store.js";
import { saveConfig, type GnamiConfig } from "../core/config.js";
import { AgentRuntime } from "../providers/agent.js";
import { TelegramChannel } from "../channels/telegram.js";
import type { ChannelName, InboundMessage } from "../types.js";
import type { RawData, WebSocket } from "ws";
import { MemoryService } from "../core/memory.js";
import { hasSkill, installSkill, listSkills } from "../core/skills.js";
import { executeAgentActions, parseAgentActions, stripAgentActions } from "../core/actions.js";
import { createIntegrationRuntime } from "../integrations/runtime.js";
import {
  buildWorkspaceContext,
  ensureWorkspaceDocs,
  readWorkspaceDoc,
  readWorkspaceDocs,
  resolveAssistantName,
  writeWorkspaceDoc
} from "../core/workspace.js";
import { resolveRuntimeEnvVar } from "../core/env.js";
import { MEMORY_ENTITY_LOCK_PATH } from "../utils/paths.js";
import { existsSync } from "node:fs";

export interface GatewayOptions {
  config: GnamiConfig;
  logger: pino.Logger;
  port?: number;
}

interface ClientMessage {
  type: "message";
  content: string;
}

const webchatClients = new Map<string, WebSocket>();

function senderKey(channel: ChannelName, senderId: string): string {
  return `${channel}:${senderId}`;
}

function isIdentityQuestion(text: string): boolean {
  return /\b(who are you|what are you|your name|who am i talking to)\b/i.test(text);
}

function soulToIdentityReply(soulDoc: string, assistantName: string): string {
  const cleaned = soulDoc
    .replace(/^#\s*SOUL\s*$/im, "")
    .trim();
  if (!cleaned) {
    return `I am ${assistantName}, your local-first personal assistant running on this computer.`;
  }
  const firstParagraph = cleaned.split(/\n\s*\n/)[0]?.trim();
  if (!firstParagraph) {
    return `I am ${assistantName}, your local-first personal assistant running on this computer.`;
  }
  return firstParagraph;
}

type PersonaFields = {
  assistantName?: string;
  userName?: string;
  language?: string;
};

async function readPersona(defaultAssistantName: string): Promise<Required<PersonaFields>> {
  const memoryDoc = await readWorkspaceDoc("MEMORY.md");
  const soulDoc = await readWorkspaceDoc("SOUL.md");
  const assistantFromMemory = memoryDoc.match(/assistant\s*name\s*:\s*([^\n\r]+)/i)?.[1]?.trim();
  const assistantFromSoul = soulDoc.match(/you are\s+([^\n\r.]+)/i)?.[1]?.trim();
  const userName = memoryDoc.match(/user\s*name\s*:\s*([^\n\r]+)/i)?.[1]?.trim();
  const language = memoryDoc.match(/preferred\s*language\s*:\s*([^\n\r]+)/i)?.[1]?.trim();
  return {
    assistantName: assistantFromMemory || assistantFromSoul || defaultAssistantName,
    userName: userName || "",
    language: language || ""
  };
}

function parsePersonaInput(text: string): PersonaFields {
  const parsed: PersonaFields = {};
  const pairRegex = /(?:^|[;,\n])\s*(assistant|assistant_name|bot|bot_name|language|lang|user|user_name)\s*[:=]\s*([^;,\n]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(text))) {
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (!value) continue;
    if (key.includes("assistant") || key.includes("bot")) parsed.assistantName = value;
    else if (key.includes("lang")) parsed.language = value;
    else if (key.includes("user")) parsed.userName = value;
  }

  const assistantPhrase = text.match(/(?:call\s+you|your\s+name\s+is)\s+([a-z0-9 _-]{2,40})/i)?.[1]?.trim();
  if (!parsed.assistantName && assistantPhrase) parsed.assistantName = assistantPhrase;
  const userPhrase = text.match(/(?:my\s+name\s+is|i\s+am)\s+([a-z0-9 _-]{2,40})/i)?.[1]?.trim();
  if (!parsed.userName && userPhrase) parsed.userName = userPhrase;
  const langPhrase = text.match(/(?:language\s*(?:is)?|i\s*speak)\s+([a-z0-9 _-]{2,40})/i)?.[1]?.trim();
  if (!parsed.language && langPhrase) parsed.language = langPhrase;

  // French natural phrasing support.
  const assistantFr =
    text.match(/(?:tu\s+t'?appelles|appelle[-\s]?toi|ton\s+nom\s+est)\s+([a-z0-9 _-]{2,40})/i)?.[1]?.trim();
  if (!parsed.assistantName && assistantFr) parsed.assistantName = assistantFr;
  const userFr =
    text.match(/(?:mon\s+nom\s+c'?est|je\s+m'?appelle)\s+([a-z0-9 _-]{2,40})/i)?.[1]?.trim();
  if (!parsed.userName && userFr) parsed.userName = userFr;
  const langFr =
    text.match(/(?:langue|je\s+parle)\s*(?:est|:)?\s*([a-z0-9 _-]{2,60})/i)?.[1]?.trim();
  if (!parsed.language && langFr) parsed.language = langFr;

  // Allow free speech patterns like: "GnamiBot, Francais Quebecois, Mon nom c'est Gabriel"
  if (!parsed.assistantName || !parsed.language || !parsed.userName) {
    const chunks = text
      .split(/[,\n]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (chunks.length >= 2) {
      const looksLikeUser = (value: string) =>
        /(?:my\s+name|i\s+am|mon\s+nom|m'?appelle|c'?est)\b/i.test(value);
      const looksLikeLang = (value: string) =>
        /(?:fran[cç]ais|english|spanish|qu[eé]b[eé]cois|lang(?:uage)?|je\s+parle)/i.test(value);

      if (!parsed.userName) {
        const rawUser = chunks.find((chunk) => looksLikeUser(chunk));
        if (rawUser) {
          parsed.userName =
            rawUser
              .replace(/^(?:my\s+name\s+is|i\s+am|mon\s+nom\s+c'?est|je\s+m'?appelle)\s+/i, "")
              .trim() || parsed.userName;
        }
      }
      if (!parsed.language) {
        const rawLang = chunks.find((chunk) => looksLikeLang(chunk));
        if (rawLang) {
          parsed.language = rawLang
            .replace(/^(?:language\s*(?:is)?|lang(?:ue)?\s*(?:est)?|je\s+parle)\s+/i, "")
            .trim();
        }
      }
      if (!parsed.assistantName) {
        const candidate = chunks.find((chunk) => !looksLikeUser(chunk) && !looksLikeLang(chunk));
        if (candidate && candidate.length <= 40) {
          parsed.assistantName = candidate.replace(/[^\w _-]/g, "").trim();
        }
      }
      if (!parsed.userName) {
        const remaining = chunks.filter((chunk) => {
          const normalized = chunk.replace(/[^\w _-]/g, "").trim();
          if (!normalized) return false;
          if (parsed.assistantName && normalized.toLowerCase() === parsed.assistantName.toLowerCase()) {
            return false;
          }
          if (looksLikeLang(chunk)) return false;
          return true;
        });
        const fallbackUser = remaining[remaining.length - 1];
        if (fallbackUser) {
          parsed.userName = fallbackUser.replace(/[^\w _-]/g, "").trim();
        }
      }
    }
  }

  return parsed;
}

function upsertLine(doc: string, key: string, value: string): string {
  const re = new RegExp(`^${key}:\\s*.*$`, "im");
  if (re.test(doc)) return doc.replace(re, `${key}: ${value}`);
  return `${doc.trimEnd()}\n- ${key}: ${value}\n`;
}

async function applyPersonaSetup(
  config: GnamiConfig,
  updates: PersonaFields
): Promise<Required<PersonaFields>> {
  let memoryDoc = await readWorkspaceDoc("MEMORY.md");
  let soulDoc = await readWorkspaceDoc("SOUL.md");
  const current = await readPersona(config.agent.assistantName ?? "GnamiBot");
  const next = {
    assistantName: updates.assistantName?.trim() || current.assistantName,
    userName: updates.userName?.trim() || current.userName,
    language: updates.language?.trim() || current.language
  };

  memoryDoc = upsertLine(memoryDoc, "Assistant name", next.assistantName);
  if (next.userName) memoryDoc = upsertLine(memoryDoc, "User name", next.userName);
  if (next.language) memoryDoc = upsertLine(memoryDoc, "Preferred language", next.language);
  soulDoc = soulDoc.replace(/You are [^\n\r.]+\.?/i, `You are ${next.assistantName}.`);

  await writeWorkspaceDoc("MEMORY.md", memoryDoc);
  await writeWorkspaceDoc("SOUL.md", soulDoc);
  if (config.agent.assistantName !== next.assistantName) {
    config.agent.assistantName = next.assistantName;
    await saveConfig(config);
  }
  return next;
}

function personaPrompt(persona: Required<PersonaFields>): string {
  const missing = [];
  if (!persona.assistantName) missing.push("assistant name");
  if (!persona.language) missing.push("language");
  if (!persona.userName) missing.push("your name");
  if (missing.length === 0) {
    return "";
  }
  return "Before we start: what should I call myself, what language do you want, and what is your name?";
}

export async function startGateway(options: GatewayOptions): Promise<void> {
  const store = await Store.open();
  const agent = new AgentRuntime(options.config);
  const memory = new MemoryService(options.config);
  const integrations = createIntegrationRuntime(options.config);
  const startedAt = new Date().toISOString();
  await ensureWorkspaceDocs();
  const app = Fastify({ loggerInstance: options.logger });
  const webRoot = join(process.cwd(), "webchat");
  const telegram = options.config.channels.telegram
    ? new TelegramChannel(options.config.channels.telegram, handleInbound)
    : null;

  await app.register(fastifyWebsocket);
  await app.register(fastifyStatic, {
    root: webRoot,
    prefix: "/"
  });

  function isAuthorized(request: FastifyRequest): boolean {
    const ip = request.ip ?? "";
    const local =
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "::ffff:127.0.0.1" ||
      ip.endsWith("127.0.0.1");
    if (local) {
      return true;
    }
    const configured = options.config.gateway.authToken;
    if (!configured) return true;
    const incoming = request.headers["x-gnamiai-token"];
    const queryToken =
      typeof (request.query as { token?: unknown }).token === "string"
        ? ((request.query as { token?: string }).token ?? "")
        : "";
    return incoming === configured || queryToken === configured;
  }

  async function handleInbound(message: InboundMessage): Promise<void> {
    try {
      const pairing = store.upsertPairing(message.channel, message.senderId);
      if (!pairing.approved) {
        await message.reply(
          `Pairing required. Approve with: gnamiai pairing approve ${message.channel} ${pairing.code}`
        );
        return;
      }

      const userScopedId = `${message.channel}:${message.senderId}`;
      if (message.content.startsWith("/skill install ")) {
        const [firstLine, ...rest] = message.content.split("\n");
        const skillName = firstLine.replace("/skill install ", "").trim();
        const skillContent = rest.join("\n").trim();
        if (!skillName || !skillContent) {
          await message.reply(
            "Usage: /skill install <name> followed by SKILL.md content on next lines."
          );
          return;
        }
        const skillId = await installSkill(skillName, skillContent);
        try {
          const write = await memory.addSkillMemory(userScopedId, skillName, skillContent);
          store.addMemoryEvent(userScopedId, "saved", `skill:${skillName} backend:${write.backend}`);
        } catch (error) {
          store.addMemoryEvent(
            userScopedId,
            "failed",
            `skill:${skillName} ${error instanceof Error ? error.message : String(error)}`
          );
        }
        await message.reply(`Skill installed: ${skillId}`);
        return;
      }

      if (message.content.startsWith("/skill restore ")) {
        const skillName = message.content.replace("/skill restore ", "").trim();
        if (!skillName) {
          await message.reply("Usage: /skill restore <name>");
          return;
        }
        if (await hasSkill(skillName)) {
          await message.reply(`Skill already installed: ${skillName}`);
          return;
        }
        const remembered = await memory.findSkill(userScopedId, skillName);
        if (!remembered) {
          await message.reply(`No remembered skill found for "${skillName}".`);
          return;
        }
        const skillId = await installSkill(skillName, remembered);
        await message.reply(`Skill restored from memory: ${skillId}`);
        return;
      }

      const sessionId = store.getOrCreateSession(message.channel, message.senderId);
      store.addMessage(sessionId, "inbound", message.content);
      const history = store.getRecentMessages(sessionId, 30);
      const historyHint = history
        .slice(-8)
        .map((entry) => `${entry.direction === "inbound" ? "User" : "Assistant"}: ${entry.content}`)
        .join("\n");
      const memoryContext = await memory.getContext(userScopedId, message.content, historyHint);
      const persona = await readPersona(options.config.agent.assistantName ?? "GnamiBot");
      const parsedPersona = parsePersonaInput(message.content);
      if (!persona.userName || !persona.language) {
        if (!parsedPersona.assistantName && !parsedPersona.userName && !parsedPersona.language) {
          const prompt = personaPrompt(persona);
          store.addMessage(sessionId, "outbound", prompt);
          await message.reply(prompt);
          return;
        }
        const updated = await applyPersonaSetup(options.config, parsedPersona);
        if (!updated.userName || !updated.language) {
          const prompt = personaPrompt(updated);
          store.addMessage(sessionId, "outbound", prompt);
          await message.reply(prompt);
          return;
        }
        const intro = `Setup complete. I am ${updated.assistantName}. I will speak ${updated.language}. Nice to meet you, ${updated.userName}.`;
        store.addMessage(sessionId, "outbound", intro);
        await message.reply(intro);
        return;
      }
      if (isIdentityQuestion(message.content)) {
        const soulDoc = await readWorkspaceDoc("SOUL.md");
        const assistantName = await resolveAssistantName(options.config.agent.assistantName);
        const identityReply = soulToIdentityReply(soulDoc, assistantName);
        store.addMessage(sessionId, "outbound", identityReply);
        try {
          const write = await memory.addConversationMemory(
            userScopedId,
            message.content,
            identityReply
          );
          store.addMemoryEvent(userScopedId, "saved", `identity-reply backend:${write.backend}`);
        } catch (error) {
          store.addMemoryEvent(
            userScopedId,
            "failed",
            `identity-reply ${error instanceof Error ? error.message : String(error)}`
          );
        }
        await message.reply(identityReply);
        return;
      }
      const workspaceContext = await buildWorkspaceContext();
      const firstPass = await agent.respond({
        input: `${message.content}\n\nWorkspace context:\n${workspaceContext}`,
        history,
        thinking: "medium",
        memoryContext
      });
      const actions = parseAgentActions(firstPass).slice(0, 3);
      let assistant = stripAgentActions(firstPass);

      if (actions.length > 0) {
        const actionResults = await executeAgentActions(actions, { integrations });
        const actionSummary = actionResults
          .map((result, index) => {
            return [
              `Action ${index + 1}: ${result.action.type}`,
              `Success: ${result.ok ? "yes" : "no"}`,
              `Output: ${result.output}`
            ].join("\n");
          })
          .join("\n\n");

        const secondPass = await agent.respond({
          input: [
            `Original user request: ${message.content}`,
            "Actions were executed. Summarize outcome clearly and keep concise.",
            "Do not emit new gnami-action blocks in this answer.",
            "",
            actionSummary
          ].join("\n"),
          history,
          thinking: "medium",
          memoryContext: [memoryContext, workspaceContext].filter(Boolean).join("\n\n")
        });
        assistant = stripAgentActions(secondPass) || assistant || "Action completed.";
      }

      store.addMessage(sessionId, "outbound", assistant);
      try {
        const write = await memory.addConversationMemory(userScopedId, message.content, assistant);
        store.addMemoryEvent(userScopedId, "saved", `backend:${write.backend}`);
      } catch (error) {
        store.addMemoryEvent(
          userScopedId,
          "failed",
          error instanceof Error ? error.message : String(error)
        );
      }
      await message.reply(assistant);
    } catch (error) {
      options.logger.error({ err: error }, "Inbound message handling failed");
      await message.reply(
        `GnamiAI error: ${error instanceof Error ? error.message : "unknown runtime failure"}`
      );
    }
  }

  app.get("/health", async (_req, reply) => {
    return reply.send({ ok: true });
  });

  app.get("/api/sessions", async (req, reply) => {
    if (!isAuthorized(req)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return reply.send({ sessions: store.listSessions() });
  });

  app.get("/api/overview", async (req, reply) => {
    if (!isAuthorized(req)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const stats = store.getOverviewStats();
    const mem0KeyLoaded = Boolean(resolveRuntimeEnvVar("MEM0_API_KEY"));
    const memoryEntity =
      resolveRuntimeEnvVar("MEM0_ENTITY") ??
      resolveRuntimeEnvVar("MEM0_ENTITY_NAME") ??
      options.config.memory.entityName ??
      null;
    return reply.send({
      health: "ok",
      model: options.config.agent.model,
      authMode: options.config.agent.openaiAuthMode,
      gatewayPort: options.config.gateway.port,
      channelsConfigured: {
        webchat: options.config.channels.webchat?.enabled ?? false,
        telegram: Boolean(options.config.channels.telegram?.botToken)
      },
      memory: {
        enabled: options.config.memory.enabled,
        provider: mem0KeyLoaded ? "mem0" : "basic",
        envKeyLoaded: mem0KeyLoaded,
        entity: memoryEntity,
        entityLocked: existsSync(MEMORY_ENTITY_LOCK_PATH)
      },
      instance: {
        host: hostname(),
        platform: `${platform()} ${release()}`,
        pid: process.pid,
        startedAt
      },
      stats
    });
  });

  app.get("/api/instances", async (req, reply) => {
    if (!isAuthorized(req)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return reply.send({
      instances: [
        {
          id: `host:${hostname()}`,
          host: hostname(),
          platform: `${platform()} ${release()}`,
          pid: process.pid,
          node: process.version,
          cwd: process.cwd(),
          startedAt
        }
      ]
    });
  });

  app.get("/api/skills", async (req, reply) => {
    if (!isAuthorized(req)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    try {
      const skills = await listSkills();
      return reply.send({ skills });
    } catch {
      return reply.send({ skills: [] });
    }
  });

  app.get("/api/workspace/docs", async (req, reply) => {
    if (!isAuthorized(req)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return reply.send({ docs: await readWorkspaceDocs() });
  });

  app.put<{ Params: { name: string }; Body: { content: string } }>(
    "/api/workspace/docs/:name",
    async (req, reply) => {
      if (!isAuthorized(req)) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const content = (req.body?.content ?? "").toString();
      await writeWorkspaceDoc(req.params.name, content);
      return reply.send({ ok: true });
    }
  );

  app.get<{ Querystring: { sessionId: string } }>("/api/messages", async (req, reply) => {
    if (!isAuthorized(req)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const sessionId = Number(req.query.sessionId);
    if (!Number.isFinite(sessionId)) {
      return reply.code(400).send({ error: "Invalid sessionId" });
    }
    return reply.send({ messages: store.getRecentMessages(sessionId, 200) });
  });

  app.post<{ Body: { channel?: ChannelName; to: string; message: string } }>(
    "/api/send",
    async (req, reply) => {
      if (!isAuthorized(req)) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const channel = req.body.channel ?? "webchat";
      const to = req.body.to?.trim();
      const content = req.body.message?.trim();
      if (!to || !content) {
        return reply.code(400).send({ error: "Both 'to' and 'message' are required" });
      }
      if (channel === "telegram") {
        if (!telegram) {
          return reply.code(400).send({ error: "Telegram channel not configured" });
        }
        await telegram.send(to, content);
      } else {
        const client = webchatClients.get(senderKey("webchat", to));
        if (!client) {
          return reply.code(404).send({ error: "WebChat client not connected" });
        }
        client.send(JSON.stringify({ type: "assistant", content }));
      }
      return reply.send({ ok: true });
    }
  );

  app.get("/ws", { websocket: true }, (socket, req) => {
    if (!isAuthorized(req)) {
      socket.close(4001, "Unauthorized");
      return;
    }
    const senderId = `${String((req.query as { sender?: string }).sender ?? "").trim()}`;
    if (!senderId) {
      socket.close(4002, "sender is required");
      return;
    }
    webchatClients.set(senderKey("webchat", senderId), socket);
    socket.on("message", async (raw: RawData) => {
      try {
        const payload = JSON.parse(raw.toString()) as ClientMessage;
        if (payload.type !== "message" || !payload.content?.trim()) {
          return;
        }
        await handleInbound({
          channel: "webchat",
          senderId,
          content: payload.content.trim(),
          reply: async (content: string) => {
            socket.send(JSON.stringify({ type: "assistant", content }));
          }
        });
      } catch (error) {
        options.logger.error({ err: error }, "Failed to process ws message");
      }
    });
    socket.on("close", () => {
      webchatClients.delete(senderKey("webchat", senderId));
    });
  });

  app.addHook("onClose", async () => {
    telegram?.stop();
    store.close();
  });

  telegram?.start();
  const port = options.port ?? options.config.gateway.port;
  await app.listen({ port, host: "127.0.0.1" });
}
