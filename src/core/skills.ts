import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GNAMI_HOME } from "../utils/paths.js";

const SKILLS_DIR = join(GNAMI_HOME, "workspace", "skills");

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export async function ensureSkillsDir(): Promise<void> {
  await mkdir(SKILLS_DIR, { recursive: true });
}

export async function installSkill(name: string, content: string): Promise<string> {
  await ensureSkillsDir();
  const skillSlug = slugify(name);
  if (!skillSlug) {
    throw new Error("Skill name must include letters or numbers.");
  }
  const skillDir = join(SKILLS_DIR, skillSlug);
  await mkdir(skillDir, { recursive: true });
  const filePath = join(skillDir, "SKILL.md");
  await writeFile(filePath, content, "utf-8");
  return skillSlug;
}

export async function hasSkill(name: string): Promise<boolean> {
  await ensureSkillsDir();
  const skillSlug = slugify(name);
  try {
    await readFile(join(SKILLS_DIR, skillSlug, "SKILL.md"), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export async function listSkills(): Promise<string[]> {
  await ensureSkillsDir();
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

