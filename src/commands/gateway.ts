import { ensureConfig } from "../core/config.js";
import { createLogger } from "../utils/logger.js";
import { startGateway } from "../gateway/server.js";

export async function runGateway(port: number | undefined, verbose: boolean): Promise<void> {
  const config = await ensureConfig();
  const logger = createLogger(verbose);
  await startGateway({
    config,
    logger,
    port
  });
}

