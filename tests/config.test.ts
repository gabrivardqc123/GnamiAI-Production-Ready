import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { ensureConfig } from "../src/core/config.js";
import { CONFIG_PATH } from "../src/utils/paths.js";

describe("config", () => {
  it("creates default config when missing", async () => {
    const config = await ensureConfig();
    expect(config.gateway.port).toBeTypeOf("number");
    expect(config.agent.model).toContain("/");
    expect(existsSync(CONFIG_PATH)).toBe(true);
  });
});

