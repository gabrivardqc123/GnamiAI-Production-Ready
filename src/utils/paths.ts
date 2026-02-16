import { homedir } from "node:os";
import { join } from "node:path";

export const GNAMI_HOME = process.env.GNAMI_HOME ?? join(homedir(), ".gnamiai");
export const CONFIG_PATH = join(GNAMI_HOME, "gnamiai.json");
export const DATA_DIR = join(GNAMI_HOME, "data");
export const DB_PATH = join(DATA_DIR, "gateway.sqlite");
export const BASIC_MEMORY_PATH = join(DATA_DIR, "basic-memory.json");
export const MEMORY_ENTITY_LOCK_PATH = join(DATA_DIR, "memory-entity.lock");
