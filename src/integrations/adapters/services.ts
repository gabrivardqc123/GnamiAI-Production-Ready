import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BaseAdapter } from "../base.js";
import { asObject, asOptionalString, asString, httpJson } from "../helpers.js";

export class SpotifyAdapter extends BaseAdapter {
  readonly name = "spotify" as const;
  private get accessToken(): string | undefined {
    return asOptionalString(this.config?.accessToken);
  }

  isConfigured(): boolean {
    return Boolean(this.accessToken);
  }

  async healthCheck() {
    if (!this.isConfigured()) return { ok: false, details: "Missing accessToken." };
    await httpJson("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${this.accessToken ?? ""}` }
    });
    return { ok: true, details: "Spotify token is valid." };
  }

  async execute(action: string, params: Record<string, unknown>) {
    const headers = {
      Authorization: `Bearer ${this.accessToken ?? ""}`,
      "Content-Type": "application/json"
    };
    if (action === "search_tracks") {
      const q = encodeURIComponent(asString(params.q, "q"));
      const limit = Number(params.limit ?? 10);
      return await httpJson(
        `https://api.spotify.com/v1/search?type=track&q=${q}&limit=${Number.isFinite(limit) ? limit : 10}`,
        { headers }
      );
    }
    if (action === "play_uri") {
      const uri = asString(params.uri, "uri");
      await httpJson(
        "https://api.spotify.com/v1/me/player/play",
        { method: "PUT", headers, body: JSON.stringify({ uris: [uri] }) },
        [204]
      );
      return { ok: true };
    }
    if (action === "current_playback") {
      return await httpJson("https://api.spotify.com/v1/me/player", { headers }, [200, 204]);
    }
    throw new Error(`Unsupported spotify action "${action}".`);
  }
}

export class HueAdapter extends BaseAdapter {
  readonly name = "hue" as const;
  private get bridgeIp(): string | undefined {
    return asOptionalString(this.config?.bridgeIp);
  }
  private get appKey(): string | undefined {
    return asOptionalString(this.config?.appKey);
  }

  isConfigured(): boolean {
    return Boolean(this.bridgeIp && this.appKey);
  }

  async healthCheck() {
    if (!this.isConfigured()) return { ok: false, details: "Missing bridgeIp or appKey." };
    await httpJson(`https://${this.bridgeIp}/clip/v2/resource/bridge`, {
      headers: { "hue-application-key": this.appKey ?? "" }
    });
    return { ok: true, details: "Hue bridge API reachable." };
  }

  async execute(action: string, params: Record<string, unknown>) {
    const base = `https://${this.bridgeIp}`;
    const headers = {
      "hue-application-key": this.appKey ?? "",
      "Content-Type": "application/json"
    };
    if (action === "list_lights") {
      return await httpJson(`${base}/clip/v2/resource/light`, { headers });
    }
    if (action === "set_light_state") {
      const lightId = asString(params.lightId, "lightId");
      const body = asObject(params.state, "state");
      return await httpJson(`${base}/clip/v2/resource/light/${lightId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body)
      });
    }
    throw new Error(`Unsupported hue action "${action}".`);
  }
}

export class ObsidianAdapter extends BaseAdapter {
  readonly name = "obsidian" as const;
  private get vaultPath(): string | undefined {
    return asOptionalString(this.config?.vaultPath);
  }

  isConfigured(): boolean {
    return Boolean(this.vaultPath);
  }

  private resolveNotePath(notePath: string): string {
    const vault = asString(this.vaultPath, "vaultPath");
    const full = resolve(vault, notePath);
    const normalizedVault = resolve(vault);
    if (!full.startsWith(normalizedVault)) {
      throw new Error("Note path escapes configured vault.");
    }
    return full;
  }

  async healthCheck() {
    if (!this.isConfigured()) return { ok: false, details: "Missing vaultPath." };
    return existsSync(asString(this.vaultPath, "vaultPath"))
      ? { ok: true, details: "Vault path exists." }
      : { ok: false, details: "Vault path does not exist." };
  }

  async execute(action: string, params: Record<string, unknown>) {
    const notePath = asString(params.notePath, "notePath");
    const fullPath = this.resolveNotePath(notePath);
    if (action === "append_note") {
      const content = asString(params.content, "content");
      await mkdir(resolve(fullPath, ".."), { recursive: true });
      const existing = existsSync(fullPath) ? await readFile(fullPath, "utf-8") : "";
      const body = `${existing}${existing ? "\n" : ""}${content}\n`;
      await writeFile(fullPath, body, "utf-8");
      return { ok: true, path: fullPath };
    }
    if (action === "read_note") {
      const content = await readFile(fullPath, "utf-8");
      return { path: fullPath, content };
    }
    if (action === "overwrite_note") {
      const content = asString(params.content, "content");
      await mkdir(resolve(fullPath, ".."), { recursive: true });
      await writeFile(fullPath, `${content}\n`, "utf-8");
      return { ok: true, path: fullPath };
    }
    throw new Error(`Unsupported obsidian action "${action}".`);
  }
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export class TwitterAdapter extends BaseAdapter {
  readonly name = "twitter" as const;
  private get bearerToken(): string | undefined {
    return asOptionalString(this.config?.bearerToken);
  }

  isConfigured(): boolean {
    return Boolean(this.bearerToken);
  }

  async healthCheck() {
    if (!this.isConfigured()) return { ok: false, details: "Missing bearerToken." };
    await httpJson("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${this.bearerToken ?? ""}` }
    });
    return { ok: true, details: "Twitter/X token is valid." };
  }

  async execute(action: string, params: Record<string, unknown>) {
    const headers = {
      Authorization: `Bearer ${this.bearerToken ?? ""}`,
      "Content-Type": "application/json"
    };
    if (action === "post_tweet") {
      const text = asString(params.text, "text");
      return await httpJson("https://api.twitter.com/2/tweets", {
        method: "POST",
        headers,
        body: JSON.stringify({ text })
      });
    }
    if (action === "search_recent") {
      const query = encodeURIComponent(asString(params.query, "query"));
      const maxResults = Number(params.maxResults ?? 10);
      return await httpJson(
        `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=${Number.isFinite(maxResults) ? maxResults : 10}`,
        { headers }
      );
    }
    throw new Error(`Unsupported twitter action "${action}".`);
  }
}

export class GmailAdapter extends BaseAdapter {
  readonly name = "gmail" as const;
  private get accessToken(): string | undefined {
    return asOptionalString(this.config?.accessToken);
  }

  isConfigured(): boolean {
    return Boolean(this.accessToken);
  }

  async healthCheck() {
    if (!this.isConfigured()) return { ok: false, details: "Missing accessToken." };
    await httpJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${this.accessToken ?? ""}` }
    });
    return { ok: true, details: "Gmail API token is valid." };
  }

  async execute(action: string, params: Record<string, unknown>) {
    const headers = {
      Authorization: `Bearer ${this.accessToken ?? ""}`,
      "Content-Type": "application/json"
    };
    if (action === "send_email") {
      const to = asString(params.to, "to");
      const subject = asString(params.subject, "subject");
      const text = asString(params.text, "text");
      const mime = [
        `To: ${to}`,
        "Content-Type: text/plain; charset=utf-8",
        `Subject: ${subject}`,
        "",
        text
      ].join("\r\n");
      return await httpJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers,
        body: JSON.stringify({ raw: toBase64Url(mime) })
      });
    }
    if (action === "list_messages") {
      const q = encodeURIComponent(asOptionalString(params.q) ?? "");
      return await httpJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}`, {
        headers
      });
    }
    throw new Error(`Unsupported gmail action "${action}".`);
  }
}

export class GitHubAdapter extends BaseAdapter {
  readonly name = "github" as const;
  private get token(): string | undefined {
    return asOptionalString(this.config?.token);
  }
  private get baseUrl(): string {
    return asOptionalString(this.config?.baseUrl) ?? "https://api.github.com";
  }

  isConfigured(): boolean {
    return Boolean(this.token);
  }

  async healthCheck() {
    if (!this.isConfigured()) return { ok: false, details: "Missing token." };
    await httpJson(`${this.baseUrl}/user`, {
      headers: {
        Authorization: `Bearer ${this.token ?? ""}`,
        "User-Agent": "GnamiAI"
      }
    });
    return { ok: true, details: "GitHub token is valid." };
  }

  async execute(action: string, params: Record<string, unknown>) {
    const owner = asOptionalString(params.owner);
    const repo = asOptionalString(params.repo);
    const headers = {
      Authorization: `Bearer ${this.token ?? ""}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GnamiAI",
      "Content-Type": "application/json"
    };
    if (action === "create_issue") {
      const safeOwner = asString(owner, "owner");
      const safeRepo = asString(repo, "repo");
      const title = asString(params.title, "title");
      const body = asOptionalString(params.body) ?? "";
      return await httpJson(`${this.baseUrl}/repos/${safeOwner}/${safeRepo}/issues`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title, body })
      });
    }
    if (action === "list_issues") {
      const safeOwner = asString(owner, "owner");
      const safeRepo = asString(repo, "repo");
      return await httpJson(`${this.baseUrl}/repos/${safeOwner}/${safeRepo}/issues`, { headers });
    }
    if (action === "create_comment") {
      const safeOwner = asString(owner, "owner");
      const safeRepo = asString(repo, "repo");
      const issueNumber = Number(params.issueNumber);
      if (!Number.isInteger(issueNumber) || issueNumber < 1) {
        throw new Error("issueNumber must be a positive integer.");
      }
      const body = asString(params.body, "body");
      return await httpJson(
        `${this.baseUrl}/repos/${safeOwner}/${safeRepo}/issues/${issueNumber}/comments`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ body })
        }
      );
    }
    throw new Error(`Unsupported github action "${action}".`);
  }
}

