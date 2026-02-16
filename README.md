# GnamiAI

GnamiAI is a local-first personal AI gateway + CLI with real providers, real channels, and a production-usable dashboard.

<p align="center">
  <img src="./gnamiai.png" alt="GnamiAI hippopotamus logo" width="180" />
</p>

## Features

- Local gateway (`127.0.0.1:18789` by default)
- WebChat (WebSocket)
- Telegram channel (real Bot API polling/send)
- App integrations via skills/connectors: WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Spotify, Hue, Obsidian, Twitter/X, Browser, Gmail, GitHub, and more
- Native adapters included for: WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Spotify, Hue, Obsidian, Twitter/X, Browser (CDP), Gmail, GitHub
- Pairing approval flow for unknown senders
- OpenAI (Codex OAuth/API key) + local model provider
- OpenAI model strategy: `gpt-5.3-codex` with fallback `gpt-5.2-codex`
- Local model strategy via `local/<model>` using OpenAI-compatible endpoint (default Ollama `http://127.0.0.1:11434/v1`)
- Optional Mem0 external memory
- Browser Control: browse the web, fill forms, and extract data from sites through browser automation tools
- Full System Access: read/write files, run shell commands, execute scripts; run sandboxed or full-access based on runtime policy

## Requirements

- Node.js `>=22`
- npm
- Optional: Codex CLI for OAuth login flow (`codex --login`)
- Optional: local model server (Ollama recommended)
- Optional: Telegram bot token
- Optional: Mem0 API key

## PowerShell Quickstart

```powershell
cd "D:\GnamiAI Production Ready"
npm install
npm run build
npm link
gnamiai onboard
gnamiai gateway --verbose
```

If `npm link` is not available in your environment, use:

```powershell
npx gnamiai onboard
npx gnamiai gateway --verbose
```

## Environment

Create `.env` from `.env.example` and fill values you need:

```powershell
Copy-Item .env.example .env
```

Mem0 example:

```env
MEM0_API_KEY=your-mem0-api-key
MEM0_ENTITY=your-entity-name
LOCAL_MODEL_BASE_URL=http://127.0.0.1:11434/v1
# LOCAL_MODEL_API_KEY=optional
```

No credentials are shipped in this repository export.

## OAuth (Codex)

```powershell
gnamiai oauth codex
```

Or:

```powershell
npx gnamiai oauth codex
```

Paste the exact callback URL printed by GnamiAI when prompted.

## Local Models

You can onboard with local models and set:
- Provider: `Local model (Ollama/OpenAI-compatible)`
- Model: e.g. `llama3.1`
- Base URL: default `http://127.0.0.1:11434/v1`

## Gateway

After onboarding:

```powershell
gnamiai gateway --verbose
```

Then open `http://127.0.0.1:18789/`.

## Useful Commands

```powershell
gnamiai doctor
gnamiai pairing approve webchat <code>
gnamiai pairing approve telegram <code>
gnamiai integration list
gnamiai integration configure --app github
gnamiai integration health --app github
gnamiai integration exec --app github --action create_issue --params '{"owner":"org","repo":"repo","title":"Test issue","body":"Created by GnamiAI"}'
```

## Integration Setup

Each native adapter is configured with real credentials and endpoints (no mocked adapters). Run:

```powershell
gnamiai integration configure
```
