import { confirm, input, password, select } from "@inquirer/prompts";
import { ensureConfig, saveConfig } from "../core/config.js";
import { createIntegrationRuntime } from "../integrations/runtime.js";
import type { IntegrationName } from "../integrations/types.js";

type FieldSpec = {
  key: string;
  label: string;
  secret?: boolean;
};

const INTEGRATION_FIELDS: Record<IntegrationName, FieldSpec[]> = {
  whatsapp: [
    { key: "accessToken", label: "WhatsApp Access Token", secret: true },
    { key: "phoneNumberId", label: "WhatsApp Phone Number ID" },
    { key: "baseUrl", label: "WhatsApp Base URL (optional)" }
  ],
  telegram: [{ key: "botToken", label: "Telegram Bot Token", secret: true }],
  discord: [
    { key: "botToken", label: "Discord Bot Token", secret: true },
    { key: "defaultChannelId", label: "Discord Default Channel ID (optional)" }
  ],
  slack: [
    { key: "botToken", label: "Slack Bot Token", secret: true },
    { key: "defaultChannel", label: "Slack Default Channel (optional)" }
  ],
  signal: [
    { key: "accountNumber", label: "Signal Account Number (E164)" },
    { key: "signalCliPath", label: "signal-cli path (optional)" }
  ],
  imessage: [{ key: "senderAccount", label: "iMessage sender account (optional)" }],
  spotify: [{ key: "accessToken", label: "Spotify Access Token", secret: true }],
  hue: [
    { key: "bridgeIp", label: "Hue Bridge IP" },
    { key: "appKey", label: "Hue Application Key", secret: true }
  ],
  obsidian: [{ key: "vaultPath", label: "Obsidian Vault Path" }],
  twitter: [{ key: "bearerToken", label: "Twitter/X Bearer Token", secret: true }],
  browser: [{ key: "debuggerUrl", label: "Browser CDP URL (optional)" }],
  gmail: [{ key: "accessToken", label: "Gmail OAuth Access Token", secret: true }],
  github: [
    { key: "token", label: "GitHub Token", secret: true },
    { key: "baseUrl", label: "GitHub API Base URL (optional)" }
  ]
};

const INTEGRATION_ORDER: IntegrationName[] = [
  "whatsapp",
  "telegram",
  "discord",
  "slack",
  "signal",
  "imessage",
  "spotify",
  "hue",
  "obsidian",
  "twitter",
  "browser",
  "gmail",
  "github"
];

function normalizeInput(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function runIntegrationList(): Promise<void> {
  const config = await ensureConfig();
  const runtime = createIntegrationRuntime(config);
  const list = runtime.list();
  for (const item of list) {
    process.stdout.write(
      `${item.app}: enabled=${item.enabled ? "yes" : "no"} configured=${item.configured ? "yes" : "no"}\n`
    );
  }
}

export async function runIntegrationHealth(app?: IntegrationName): Promise<void> {
  const config = await ensureConfig();
  const runtime = createIntegrationRuntime(config);
  const statuses = await runtime.health(app);
  for (const [name, status] of Object.entries(statuses)) {
    process.stdout.write(`${name}: ${status.ok ? "ok" : "fail"} - ${status.details}\n`);
  }
}

export async function runIntegrationExec(
  app: IntegrationName,
  action: string,
  paramsJson?: string
): Promise<void> {
  const params = paramsJson ? (JSON.parse(paramsJson) as Record<string, unknown>) : {};
  const config = await ensureConfig();
  const runtime = createIntegrationRuntime(config);
  const result = await runtime.exec({ app, action, params });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function runIntegrationConfigure(app?: IntegrationName): Promise<void> {
  const config = await ensureConfig();
  const selectedApp =
    app ??
    (await select({
      message: "Which integration do you want to configure?",
      choices: INTEGRATION_ORDER.map((name) => ({ name, value: name }))
    }));

  const appConfig = config.integrations[selectedApp] as { enabled: boolean } & Record<string, unknown>;
  const enable = await confirm({
    message: `Enable ${selectedApp}?`,
    default: appConfig.enabled
  });
  appConfig.enabled = enable;

  if (!enable) {
    await saveConfig(config);
    process.stdout.write(`Integration "${selectedApp}" disabled.\n`);
    return;
  }

  for (const field of INTEGRATION_FIELDS[selectedApp]) {
    const existing = appConfig[field.key];
    const currentValue = typeof existing === "string" ? existing : "";
    const promptOptions = {
      message: field.label,
      default: currentValue
    };
    const nextValue = field.secret
      ? await password({ ...promptOptions, mask: "*" })
      : await input(promptOptions);
    const normalized = normalizeInput(nextValue);
    if (normalized === undefined) {
      delete appConfig[field.key];
      continue;
    }
    appConfig[field.key] = normalized;
  }

  await saveConfig(config);
  process.stdout.write(`Integration "${selectedApp}" saved.\n`);
}
