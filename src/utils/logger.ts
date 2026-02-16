import pino from "pino";

export function createLogger(verbose: boolean) {
  return pino({
    level: verbose ? "debug" : "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard"
            }
          }
        : undefined
  });
}

