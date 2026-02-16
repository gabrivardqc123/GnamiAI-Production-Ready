#!/usr/bin/env node
import { Command } from "commander";
import { runOnboard } from "./commands/onboard.js";
import { runGateway } from "./commands/gateway.js";
import { runMessageSend } from "./commands/message.js";
import { runAgent } from "./commands/agent.js";
import { runDoctor } from "./commands/doctor.js";
import { runPairingApprove } from "./commands/pairing.js";
import { runUpdate } from "./commands/update.js";
import { runOauthCodex } from "./commands/oauth.js";
import type { ChannelName } from "./types.js";
import { loadEnvFiles } from "./core/env.js";
import {
  runIntegrationConfigure,
  runIntegrationExec,
  runIntegrationHealth,
  runIntegrationList
} from "./commands/integration.js";
import type { IntegrationName } from "./integrations/types.js";

loadEnvFiles();

const validChannels = new Set<ChannelName>(["webchat", "telegram"]);
const validIntegrations = new Set<IntegrationName>([
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
]);

function parseChannel(value: string): ChannelName {
  if (!validChannels.has(value as ChannelName)) {
    throw new Error(`Unsupported channel "${value}". Use webchat or telegram.`);
  }
  return value as ChannelName;
}

function parseThinking(value: string): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  throw new Error(`Unsupported thinking "${value}". Use low|medium|high.`);
}

function parseIntegration(value: string): IntegrationName {
  if (!validIntegrations.has(value as IntegrationName)) {
    throw new Error(`Unsupported integration "${value}".`);
  }
  return value as IntegrationName;
}

const program = new Command();
program.name("gnamiai").description("GnamiAI local-first assistant gateway").version("0.1.0");

program
  .command("onboard")
  .description("Run interactive setup wizard")
  .option("--install-daemon", "Install daemon service")
  .action(async (options: { installDaemon?: boolean }) => {
    await runOnboard(Boolean(options.installDaemon));
  });

program
  .command("gateway")
  .description("Start gateway server")
  .option("--port <port>", "Gateway port", (value) => Number(value))
  .option("--verbose", "Verbose logging")
  .action(async (options: { port?: number; verbose?: boolean }) => {
    await runGateway(options.port, Boolean(options.verbose));
  });

program
  .command("message")
  .description("Messaging operations")
  .command("send")
  .requiredOption("--to <target>", "Receiver id / phone / chat id")
  .requiredOption("--message <message>", "Text message to send")
  .option("--channel <channel>", "Channel: webchat|telegram", "webchat")
  .action(async (options: { to: string; message: string; channel: string }) => {
    await runMessageSend(options.to, options.message, parseChannel(options.channel));
  });

program
  .command("agent")
  .description("Send a direct one-off prompt to configured model")
  .requiredOption("--message <message>", "Prompt text")
  .option("--thinking <level>", "low|medium|high", "medium")
  .action(async (options: { message: string; thinking: string }) => {
    await runAgent(options.message, parseThinking(options.thinking));
  });

program.command("doctor").description("Run setup diagnostics").action(runDoctor);

program
  .command("pairing")
  .description("Pairing operations")
  .command("approve <channel> <code>")
  .action(async (channel: string, code: string) => {
    await runPairingApprove(parseChannel(channel), code);
  });

program
  .command("update")
  .description("Switch channel profile")
  .requiredOption("--channel <channel>", "stable|beta|dev")
  .action(async (options: { channel: "stable" | "beta" | "dev" }) => {
    await runUpdate(options.channel);
  });

program
  .command("oauth")
  .description("OAuth operations")
  .command("codex")
  .description("Authenticate with ChatGPT/Codex OAuth and import OpenAI key")
  .action(runOauthCodex);

const integration = program.command("integration").description("Native integration adapters");
integration.command("list").description("List integration status").action(runIntegrationList);
integration
  .command("configure")
  .description("Interactive integration setup")
  .option("--app <app>", "Integration app")
  .action(async (options: { app?: string }) => {
    await runIntegrationConfigure(options.app ? parseIntegration(options.app) : undefined);
  });
integration
  .command("health")
  .description("Check integration health")
  .option("--app <app>", "Integration app")
  .action(async (options: { app?: string }) => {
    await runIntegrationHealth(options.app ? parseIntegration(options.app) : undefined);
  });
integration
  .command("exec")
  .description("Execute native integration action")
  .requiredOption("--app <app>", "Integration app")
  .requiredOption("--action <action>", "Action name")
  .option("--params <json>", "JSON payload")
  .action(async (options: { app: string; action: string; params?: string }) => {
    await runIntegrationExec(parseIntegration(options.app), options.action, options.params);
  });

program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
