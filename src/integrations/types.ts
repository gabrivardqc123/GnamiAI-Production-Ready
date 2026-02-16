export type IntegrationName =
  | "whatsapp"
  | "telegram"
  | "discord"
  | "slack"
  | "signal"
  | "imessage"
  | "spotify"
  | "hue"
  | "obsidian"
  | "twitter"
  | "browser"
  | "gmail"
  | "github";

export interface IntegrationHealth {
  ok: boolean;
  details: string;
}

export interface IntegrationAdapter {
  readonly name: IntegrationName;
  isEnabled(): boolean;
  isConfigured(): boolean;
  healthCheck(): Promise<IntegrationHealth>;
  execute(action: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface IntegrationExecRequest {
  app: IntegrationName;
  action: string;
  params?: Record<string, unknown>;
}
