import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import dotenv from "dotenv";

export const ENV_PATH = join(process.cwd(), ".env");
export const ENV_EXAMPLE_PATH = join(process.cwd(), ".env.example");

export function loadEnvFiles(): void {
  // Primary runtime env file.
  dotenv.config({ path: ENV_PATH, override: false, quiet: true });
  // Fallback for users who only populated .env.example.
  dotenv.config({ path: ENV_EXAMPLE_PATH, override: false, quiet: true });
}

function readEnvFileValue(filePath: string, key: string): string | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = dotenv.parse(raw);
    const value = parsed[key];
    if (!value) return null;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

export function resolveRuntimeEnvVar(key: string): string | null {
  const direct = process.env[key];
  if (direct && String(direct).trim().length > 0) {
    return String(direct).trim();
  }
  return readEnvFileValue(ENV_PATH, key) ?? readEnvFileValue(ENV_EXAMPLE_PATH, key);
}

export async function upsertEnvVar(key: string, value: string): Promise<void> {
  const normalized = value.replace(/\r?\n/g, "").trim();
  if (!normalized) {
    throw new Error(`Cannot set empty env var for ${key}`);
  }

  let lines: string[] = [];
  if (existsSync(ENV_PATH)) {
    const raw = await readFile(ENV_PATH, "utf-8");
    lines = raw.split(/\r?\n/);
  }

  let updated = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      updated = true;
      return `${key}=${normalized}`;
    }
    return line;
  });

  if (!updated) {
    next.push(`${key}=${normalized}`);
  }

  const body = `${next.filter((line) => line.length > 0).join("\n")}\n`;
  await writeFile(ENV_PATH, body, "utf-8");
}
