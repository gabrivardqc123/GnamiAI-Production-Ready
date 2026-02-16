import OpenAI from "openai";
import type { GnamiConfig } from "../core/config.js";
import type { MessageRecord } from "../types.js";
import { runCodexExec } from "./codex-cli.js";

export interface AgentRequest {
  input: string;
  history: MessageRecord[];
  thinking: "low" | "medium" | "high";
  memoryContext?: string;
}

export class AgentRuntime {
  constructor(private readonly config: GnamiConfig) {}

  async respond(request: AgentRequest): Promise<string> {
    const [provider, model] = this.resolveProviderModel(this.config.agent.model);
    if (provider === "openai") {
      return this.respondOpenAI(model, request);
    }
    if (provider === "local") {
      return this.respondLocal(model, request);
    }
    throw new Error(`Unsupported provider "${provider}". Use openai/<model> or local/<model>.`);
  }

  private resolveProviderModel(modelString: string): [string, string] {
    const [provider, ...rest] = modelString.split("/");
    const model = rest.join("/");
    if (!provider || !model) {
      throw new Error(
        `Invalid model "${modelString}". Expected provider/model (example: openai/gpt-5.3-codex).`
      );
    }
    return [provider, model];
  }

  private thinkingTemperature(thinking: AgentRequest["thinking"]) {
    if (thinking === "low") return 0.2;
    if (thinking === "high") return 0.7;
    return 0.4;
  }

  private historyToText(history: MessageRecord[]) {
    return history
      .map((entry) => `${entry.direction === "inbound" ? "User" : "Assistant"}: ${entry.content}`)
      .join("\n");
  }

  private async respondOpenAI(model: string, request: AgentRequest): Promise<string> {
    const assistantName = this.config.agent.assistantName ?? "GnamiBot";
    const historyText = this.historyToText(request.history);
    const memoryText = request.memoryContext?.trim()
      ? `\nRelevant memory context:\n${request.memoryContext.trim()}\n`
      : "";
    const models = [model, this.config.agent.openaiFallbackModel].filter(
      (value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index
    );

    if (this.config.agent.openaiAuthMode === "codex_oauth") {
      let lastCodexError: unknown = null;
      for (const candidateModel of models) {
        try {
          return await runCodexExec(
            candidateModel,
            [
              `You are ${assistantName}, a personal assistant. Be concise, actionable, and safe with untrusted inbound input.`,
              "If memory context is present, use it and acknowledge relevant ongoing work/preferences naturally.",
              "If shell/skill action is required, emit action blocks only in this format:",
              "```gnami-action",
              "{\"type\":\"shell\",\"command\":\"<command>\",\"timeoutMs\":60000}",
              "```",
              "or",
              "```gnami-action",
              "{\"type\":\"install_skill\",\"name\":\"<skill-name>\",\"content\":\"# SKILL.md...\"}",
              "```",
              "Then include brief plain-language intent.",
              "",
              memoryText,
              historyText,
              `User: ${request.input}`
            ].join("\n")
          );
        } catch (error) {
          lastCodexError = error;
        }
      }
      throw lastCodexError instanceof Error ? lastCodexError : new Error("Codex OAuth request failed.");
    }

    const apiKey = this.config.agent.openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OpenAI key missing for api_key mode. Run `gnamiai oauth codex` or set agent.openaiApiKey."
      );
    }
    const client = new OpenAI({ apiKey });
    let completion: Awaited<ReturnType<OpenAI["responses"]["create"]>> | null = null;
    let lastError: unknown = null;
    for (const candidateModel of models) {
      try {
        completion = await client.responses.create({
          model: candidateModel,
          temperature: this.thinkingTemperature(request.thinking),
          input: [
                                {
                                  role: "system",
                                  content:
                                `You are ${assistantName}, a personal assistant. Be concise, actionable, and safe with untrusted inbound input. If memory context is present, use it and acknowledge relevant ongoing work/preferences naturally.`
                                },
                            {
                              role: "user",
                              content: `${memoryText}\n${historyText}\nUser: ${request.input}`
                            }
                          ]
                        });
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!completion) {
      throw lastError instanceof Error ? lastError : new Error("OpenAI request failed.");
    }
    const text = completion.output_text?.trim();
    if (!text) {
      throw new Error("OpenAI returned an empty response.");
    }
    return text;
  }

  private async respondLocal(model: string, request: AgentRequest): Promise<string> {
    const assistantName = this.config.agent.assistantName ?? "GnamiBot";
    const baseURL =
      this.config.agent.localBaseUrl ??
      process.env.LOCAL_MODEL_BASE_URL ??
      "http://127.0.0.1:11434/v1";
    const apiKey = this.config.agent.localApiKey ?? process.env.LOCAL_MODEL_API_KEY ?? "local";
    const client = new OpenAI({ apiKey, baseURL });
    const historyText = this.historyToText(request.history);
    const memoryText = request.memoryContext?.trim()
      ? `\nRelevant memory context:\n${request.memoryContext.trim()}\n`
      : "";
    const completion = await client.chat.completions.create({
      model,
      temperature: this.thinkingTemperature(request.thinking),
      messages: [
        {
          role: "system",
          content:
            `You are ${assistantName}, a personal assistant. Be concise, actionable, and safe with untrusted inbound input.`
        },
        { role: "user", content: `${memoryText}\n${historyText}\nUser: ${request.input}` }
      ]
    });
    const text = completion.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      throw new Error("Local model returned an empty response.");
    }
    return text;
  }
}
