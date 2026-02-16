import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { CONFIG_PATH, GNAMI_HOME } from "../utils/paths.js";

const configSchema = z.object({
  gateway: z
    .object({
      port: z.number().int().min(1).max(65535).default(18789),
      authToken: z.string().min(8).optional()
    })
    .default({ port: 18789 }),
  agent: z
    .object({
      assistantName: z.string().min(1).default("GnamiBot"),
      model: z.string().min(1).default("openai/gpt-5.3-codex"),
      openaiFallbackModel: z.string().min(1).default("gpt-5.2-codex"),
      openaiAuthMode: z.enum(["api_key", "codex_oauth"]).default("codex_oauth"),
      openaiApiKey: z.string().min(1).optional(),
      localBaseUrl: z.string().url().optional(),
      localApiKey: z.string().min(1).optional()
    })
    .default({
      assistantName: "GnamiBot",
      model: "openai/gpt-5.3-codex",
      openaiFallbackModel: "gpt-5.2-codex",
      openaiAuthMode: "codex_oauth"
    }),
  channels: z
    .object({
      telegram: z
        .object({
          botToken: z.string().min(1),
          pollingIntervalMs: z.number().int().min(1000).default(2500)
        })
        .optional(),
      webchat: z
        .object({
          enabled: z.boolean().default(true)
        })
        .default({ enabled: true })
    })
    .default({ webchat: { enabled: true } }),
  memory: z
    .object({
      enabled: z.boolean().default(false),
      provider: z.enum(["none", "mem0"]).default("none"),
      mem0ApiKey: z.string().min(1).optional(),
      mem0BaseUrl: z.string().url().optional(),
      userIdPrefix: z.string().min(1).default("gnamiai"),
      entityName: z.string().min(1).optional()
    })
    .default({ enabled: false, provider: "none", userIdPrefix: "gnamiai" })
});

export type GnamiConfig = z.infer<typeof configSchema>;

const defaultConfig: GnamiConfig = {
  gateway: { port: 18789 },
  agent: {
    assistantName: "GnamiBot",
    model: "openai/gpt-5.3-codex",
    openaiFallbackModel: "gpt-5.2-codex",
    openaiAuthMode: "codex_oauth",
    localBaseUrl: "http://127.0.0.1:11434/v1"
  },
  channels: { webchat: { enabled: true } },
  memory: { enabled: false, provider: "none", userIdPrefix: "gnamiai" }
};

export async function loadConfig(): Promise<GnamiConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return configSchema.parse(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultConfig;
    }
    throw error;
  }
}

export async function saveConfig(config: GnamiConfig): Promise<void> {
  await mkdir(GNAMI_HOME, { recursive: true });
  const validated = configSchema.parse(config);
  await writeFile(CONFIG_PATH, JSON.stringify(validated, null, 2), "utf-8");
}

export async function ensureConfig(): Promise<GnamiConfig> {
  const config = await loadConfig();
  await saveConfig(config);
  return config;
}
