import WebSocket from "ws";
import { BaseAdapter } from "../base.js";
import { asObject, asOptionalString, asString, httpJson } from "../helpers.js";

interface CdpTargetInfo {
  id: string;
  webSocketDebuggerUrl: string;
}

class CdpSession {
  private ws: WebSocket | null = null;
  private id = 0;
  private readonly pending = new Map<number, { resolve: (data: unknown) => void; reject: (err: Error) => void }>();

  constructor(private readonly wsUrl: string) {}

  async connect(): Promise<void> {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise<void>((resolve, reject) => {
      const ws = this.ws;
      if (!ws) {
        reject(new Error("WebSocket was not created."));
        return;
      }
      ws.once("open", () => resolve());
      ws.once("error", (error) => reject(error));
      ws.on("message", (raw) => {
        const payload = JSON.parse(raw.toString()) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        if (!payload.id) return;
        const pending = this.pending.get(payload.id);
        if (!pending) return;
        this.pending.delete(payload.id);
        if (payload.error) {
          pending.reject(new Error(payload.error.message ?? "CDP command failed."));
          return;
        }
        pending.resolve(payload.result);
      });
    });
  }

  async command(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const ws = this.ws;
    if (!ws) throw new Error("CDP session not connected.");
    const id = ++this.id;
    const message = JSON.stringify({ id, method, params });
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }
      }, 15000);
    });
    ws.send(message);
    return await result;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.pending.clear();
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class BrowserAdapter extends BaseAdapter {
  readonly name = "browser" as const;
  private get debuggerUrl(): string {
    return asOptionalString(this.config?.debuggerUrl) ?? "http://127.0.0.1:9222";
  }

  isConfigured(): boolean {
    return true;
  }

  async healthCheck() {
    try {
      await httpJson(`${this.debuggerUrl}/json/version`);
      return { ok: true, details: "CDP endpoint reachable." };
    } catch {
      return {
        ok: false,
        details: "CDP unavailable. Start Chrome/Edge with --remote-debugging-port=9222."
      };
    }
  }

  private async newTarget(url: string): Promise<CdpTargetInfo> {
    const response = await fetch(`${this.debuggerUrl}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT"
    });
    if (!response.ok) {
      throw new Error(
        `Cannot create CDP target (${response.status}). Ensure browser runs with --remote-debugging-port.`
      );
    }
    return (await response.json()) as CdpTargetInfo;
  }

  private async closeTarget(id: string): Promise<void> {
    await fetch(`${this.debuggerUrl}/json/close/${id}`, { method: "PUT" }).catch(() => undefined);
  }

  async execute(action: string, params: Record<string, unknown>) {
    if (action === "fetch_html") {
      const url = asString(params.url, "url");
      const response = await fetch(url);
      const html = await response.text();
      return { status: response.status, html };
    }
    if (action === "extract_text") {
      const url = asString(params.url, "url");
      const response = await fetch(url);
      const html = await response.text();
      const maxChars = Number(params.maxChars ?? 4000);
      return { text: stripHtml(html).slice(0, Number.isFinite(maxChars) ? maxChars : 4000) };
    }
    if (action === "fill_form") {
      const url = asString(params.url, "url");
      const fields = asObject(params.fields, "fields");
      const submitSelector =
        asOptionalString(params.submitSelector) ?? "button[type=submit],input[type=submit]";
      const target = await this.newTarget(url);
      const session = new CdpSession(target.webSocketDebuggerUrl);
      try {
        await session.connect();
        await session.command("Page.enable");
        await session.command("Runtime.enable");
        await session.command("Page.navigate", { url });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const fillScript = `
          (() => {
            const fields = ${JSON.stringify(fields)};
            for (const [key, value] of Object.entries(fields)) {
              const selectors = [
                key,
                '[name="' + key + '"]',
                '#' + key,
                'input[name="' + key + '"]',
                'textarea[name="' + key + '"]'
              ];
              let el = null;
              for (const sel of selectors) {
                try {
                  el = document.querySelector(sel);
                  if (el) break;
                } catch {}
              }
              if (!el) continue;
              el.focus();
              el.value = String(value);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const submit = document.querySelector(${JSON.stringify(submitSelector)});
            if (submit) submit.click();
            return { url: location.href, title: document.title };
          })();
        `;
        const result = await session.command("Runtime.evaluate", {
          expression: fillScript,
          awaitPromise: true,
          returnByValue: true
        });
        return { ok: true, result };
      } finally {
        session.close();
        await this.closeTarget(target.id);
      }
    }
    throw new Error(`Unsupported browser action "${action}".`);
  }
}

