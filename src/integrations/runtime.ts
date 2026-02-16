import type { GnamiConfig } from "../core/config.js";
import { BrowserAdapter } from "./adapters/browser.js";
import {
  DiscordAdapter,
  IMessageAdapter,
  SignalAdapter,
  SlackAdapter,
  TelegramAdapter,
  WhatsAppAdapter
} from "./adapters/communications.js";
import {
  GitHubAdapter,
  GmailAdapter,
  HueAdapter,
  ObsidianAdapter,
  SpotifyAdapter,
  TwitterAdapter
} from "./adapters/services.js";
import type { IntegrationAdapter, IntegrationExecRequest, IntegrationHealth, IntegrationName } from "./types.js";

export class IntegrationRuntime {
  private readonly adapters = new Map<IntegrationName, IntegrationAdapter>();

  constructor(adapters: IntegrationAdapter[]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.name, adapter);
    }
  }

  list(): Array<{ app: IntegrationName; enabled: boolean; configured: boolean }> {
    return [...this.adapters.values()].map((adapter) => ({
      app: adapter.name,
      enabled: adapter.isEnabled(),
      configured: adapter.isConfigured()
    }));
  }

  async health(app?: IntegrationName): Promise<Record<string, IntegrationHealth>> {
    const entries = [...this.adapters.values()].filter((adapter) => !app || adapter.name === app);
    const results: Record<string, IntegrationHealth> = {};
    for (const adapter of entries) {
      try {
        results[adapter.name] = await adapter.healthCheck();
      } catch (error) {
        results[adapter.name] = {
          ok: false,
          details: error instanceof Error ? error.message : String(error)
        };
      }
    }
    return results;
  }

  async exec(request: IntegrationExecRequest): Promise<unknown> {
    const adapter = this.adapters.get(request.app);
    if (!adapter) {
      throw new Error(`Integration adapter not found for "${request.app}".`);
    }
    if (!adapter.isEnabled()) {
      throw new Error(`Integration "${request.app}" is disabled in config.`);
    }
    if (!adapter.isConfigured()) {
      throw new Error(`Integration "${request.app}" is not configured.`);
    }
    return await adapter.execute(request.action, request.params ?? {});
  }
}

export function createIntegrationRuntime(config: GnamiConfig): IntegrationRuntime {
  const integrations = config.integrations;
  return new IntegrationRuntime([
    new WhatsAppAdapter(integrations.whatsapp),
    new TelegramAdapter(integrations.telegram),
    new DiscordAdapter(integrations.discord),
    new SlackAdapter(integrations.slack),
    new SignalAdapter(integrations.signal),
    new IMessageAdapter(integrations.imessage),
    new SpotifyAdapter(integrations.spotify),
    new HueAdapter(integrations.hue),
    new ObsidianAdapter(integrations.obsidian),
    new TwitterAdapter(integrations.twitter),
    new BrowserAdapter(integrations.browser),
    new GmailAdapter(integrations.gmail),
    new GitHubAdapter(integrations.github)
  ]);
}

