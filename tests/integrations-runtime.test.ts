import { describe, expect, it } from "vitest";
import { ensureConfig } from "../src/core/config.js";
import { createIntegrationRuntime } from "../src/integrations/runtime.js";

describe("integrations runtime", () => {
  it("registers all native adapters", async () => {
    const config = await ensureConfig();
    const runtime = createIntegrationRuntime(config);
    const apps = runtime
      .list()
      .map((entry) => entry.app)
      .sort();
    expect(apps).toEqual(
      [
        "browser",
        "discord",
        "github",
        "gmail",
        "hue",
        "imessage",
        "obsidian",
        "signal",
        "slack",
        "spotify",
        "telegram",
        "twitter",
        "whatsapp"
      ].sort()
    );
  });
});

