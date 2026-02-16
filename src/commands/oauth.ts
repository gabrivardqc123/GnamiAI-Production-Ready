import { input } from "@inquirer/prompts";
import { configureOpenAiCodexOauth, runCodexOauthLogin } from "../core/codex-oauth.js";

function normalize(value: string): string {
  return value.replace(/[\s"'`]+/g, "");
}

function extractUrls(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s"'<>]+/gi);
  return matches ?? [];
}

function parseUrlSafe(value: string): URL | null {
  try {
    return new URL(value.replace(/[.,;:!?]+$/g, ""));
  } catch {
    return null;
  }
}

function confirmMatches(pasted: string, expected: string): boolean {
  const cleanPasted = normalize(pasted);
  const cleanExpected = normalize(expected);
  if (cleanPasted === cleanExpected || cleanPasted.includes(cleanExpected)) {
    return true;
  }
  if (
    cleanPasted.includes("localhost:1455/success") &&
    cleanPasted.includes("id_token=")
  ) {
    return true;
  }

  const expectedUrl = parseUrlSafe(expected);
  const expectedState = expectedUrl?.searchParams.get("state") ?? null;
  const expectedCode = expectedUrl?.searchParams.get("code") ?? null;

  for (const candidate of extractUrls(pasted)) {
    const url = parseUrlSafe(candidate);
    if (!url) {
      continue;
    }
    if (normalize(url.toString()) === cleanExpected) {
      return true;
    }
    if (expectedState && url.searchParams.get("state") === expectedState) {
      return true;
    }
    if (expectedCode && url.searchParams.get("code") === expectedCode) {
      return true;
    }
  }

  return false;
}

export async function runOauthCodex(): Promise<void> {
  process.stdout.write("Starting Codex OAuth login flow...\n");
  const oauthUrl = await runCodexOauthLogin();
  if (oauthUrl) {
    const pasted = await input({
      message: "Paste the OAuth URL shown above to confirm",
      validate(value) {
        return confirmMatches(value, oauthUrl)
          ? true
          : "URL does not match the detected OAuth link.";
      }
    });
    if (!confirmMatches(pasted, oauthUrl)) {
      throw new Error("OAuth link confirmation failed.");
    }
  }
  const authPath = await configureOpenAiCodexOauth();
  process.stdout.write(`Codex OAuth configured from ${authPath} in ~/.gnamiai/gnamiai.json\n`);
}
