import type { IntegrationAdapter, IntegrationName } from "./types.js";

export abstract class BaseAdapter implements IntegrationAdapter {
  abstract readonly name: IntegrationName;
  constructor(protected readonly config: Record<string, unknown> | undefined) {}

  protected enabledFlag(): boolean {
    return this.config?.enabled === true;
  }

  isEnabled(): boolean {
    return this.enabledFlag();
  }

  abstract isConfigured(): boolean;
  abstract healthCheck(): Promise<{ ok: boolean; details: string }>;
  abstract execute(action: string, params: Record<string, unknown>): Promise<unknown>;
}
