const clientIdKey = "gnamiai.clientId";
const themeKey = "gnamiai.theme";
const existingClient = localStorage.getItem(clientIdKey);
const senderId = existingClient ?? `web-${Math.random().toString(36).slice(2, 10)}`;
if (!existingClient) {
  localStorage.setItem(clientIdKey, senderId);
}

const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const protocol = window.location.protocol === "https:" ? "wss" : "ws";
const wsUrl = new URL(`${protocol}://${window.location.host}/ws`);
wsUrl.searchParams.set("sender", senderId);
if (token) {
  wsUrl.searchParams.set("token", token);
}
const ws = new WebSocket(wsUrl, []);

const chat = document.getElementById("chat");
const form = document.getElementById("composer");
const input = document.getElementById("message");
const healthPill = document.getElementById("health-pill");
const viewTitle = document.getElementById("view-title");
const viewSubtitle = document.getElementById("view-subtitle");
const themeToggle = document.getElementById("theme-toggle");
const navItems = Array.from(document.querySelectorAll(".nav-item"));

const overviewCards = document.getElementById("overview-cards");
const channelsCards = document.getElementById("channels-cards");
const sessionsTable = document.getElementById("sessions-table");
const instancesTable = document.getElementById("instances-table");
const cronCards = document.getElementById("cron-cards");
const skillsCards = document.getElementById("skills-cards");
const configCards = document.getElementById("config-cards");
const docEditor = document.getElementById("doc-editor");
const docSave = document.getElementById("doc-save");
const docStatus = document.getElementById("doc-status");
const docTabs = Array.from(document.querySelectorAll(".doc-tab"));

const viewMeta = {
  chat: {
    title: "Chat",
    subtitle: "Direct gateway chat session for interventions."
  },
  overview: {
    title: "Overview",
    subtitle: "Gateway, model, and runtime metrics."
  },
  channels: {
    title: "Channels",
    subtitle: "Configured and active communication surfaces."
  },
  instances: {
    title: "Instances",
    subtitle: "Active sender instances grouped by channel."
  },
  sessions: {
    title: "Sessions",
    subtitle: "Session timeline and routing activity."
  },
  cron: {
    title: "Cron Jobs",
    subtitle: "Scheduled automation and wakeups."
  },
  skills: {
    title: "Skills.md Skills",
    subtitle: "Discovered workspace skills."
  },
  config: {
    title: "Config Settings",
    subtitle: "Current gateway and model configuration."
  }
};

let latestOverview = null;
let latestSessions = [];
let latestSkills = [];
let latestInstances = [];
let latestDocs = {};
let activeDoc = "SOUL.md";
let lastApiError = "";
let pendingTypingNode = null;
let assistantRenderQueue = Promise.resolve();

function authHeaders() {
  return token ? { "x-gnamiai-token": token } : {};
}

async function apiGet(path) {
  const response = await fetch(path, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function appendMessage(content, type) {
  const node = document.createElement("div");
  node.className = `msg ${type}`;
  node.textContent = content;
  chat.appendChild(node);
  chat.scrollTop = chat.scrollHeight;
  return node;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAssistantText(text) {
  return String(text ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function ensureTypingBubble() {
  if (pendingTypingNode && pendingTypingNode.isConnected) {
    return pendingTypingNode;
  }
  pendingTypingNode = appendMessage("", "assistant typing");
  pendingTypingNode.innerHTML =
    '<span class="typing-dots"><span></span><span></span><span></span></span>';
  return pendingTypingNode;
}

async function renderAssistantMessage(content) {
  const node = ensureTypingBubble();
  await sleep(500);
  node.classList.remove("typing");
  node.textContent = "";
  const text = normalizeAssistantText(content);
  for (let i = 0; i < text.length; i++) {
    node.textContent += text[i];
    chat.scrollTop = chat.scrollHeight;
    await sleep(12);
  }
  if (text.length === 0) {
    node.textContent = "(empty response)";
  }
  pendingTypingNode = null;
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function card(title, value) {
  const el = document.createElement("article");
  el.className = "card";
  el.innerHTML = `<h3>${title}</h3><p>${value}</p>`;
  return el;
}

function renderOverview() {
  overviewCards.innerHTML = "";
  if (!latestOverview) {
    overviewCards.append(card("Status", "No data"));
    return;
  }
  overviewCards.append(card("Model", latestOverview.model));
  overviewCards.append(card("Auth Mode", latestOverview.authMode));
  overviewCards.append(card("Sessions", String(latestOverview.stats.sessions)));
  overviewCards.append(card("Messages", String(latestOverview.stats.messages)));
  overviewCards.append(card("Pairings Approved", String(latestOverview.stats.pairingsApproved)));
  overviewCards.append(card("Pairings Pending", String(latestOverview.stats.pairingsPending)));
  overviewCards.append(card("Memory Saved", String(latestOverview.stats.memorySaved ?? 0)));
  overviewCards.append(card("Memory Failed", String(latestOverview.stats.memoryFailed ?? 0)));
}

function renderChannels() {
  channelsCards.innerHTML = "";
  if (!latestOverview) {
    channelsCards.append(card("Channels", "No data"));
    return;
  }
  const configured = latestOverview.channelsConfigured;
  channelsCards.append(card("WebChat", configured.webchat ? "Enabled" : "Disabled"));
  channelsCards.append(card("Telegram", configured.telegram ? "Configured" : "Not configured"));
  for (const entry of latestOverview.stats.byChannel) {
    channelsCards.append(card(`Sessions: ${entry.channel}`, String(entry.count)));
  }
}

function renderSessions() {
  sessionsTable.innerHTML = "";
  if (latestSessions.length === 0) {
    sessionsTable.innerHTML = `<tr><td colspan="4">No sessions yet</td></tr>`;
    return;
  }
  for (const session of latestSessions) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${session.id}</td>
      <td>${session.senderId}</td>
      <td>${session.channel}</td>
      <td>${formatTime(session.updatedAt)}</td>
    `;
    sessionsTable.append(row);
  }
}

function renderInstances() {
  instancesTable.innerHTML = "";
  if (latestInstances.length === 0) {
    instancesTable.innerHTML = `<tr><td colspan="3">No active instances</td></tr>`;
    return;
  }
  for (const instance of latestInstances) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${instance.host} (pid ${instance.pid})</td>
      <td>${instance.platform}</td>
      <td>${formatTime(instance.startedAt)}</td>
    `;
    instancesTable.append(row);
  }
}

function setActiveDoc(docName) {
  activeDoc = docName;
  docTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.doc === docName);
  });
  docEditor.value = latestDocs[docName] ?? "";
  docStatus.textContent = "";
}

function renderCron() {
  cronCards.innerHTML = "";
  cronCards.append(card("Jobs", "0"));
  cronCards.append(card("Scheduler", "Ready"));
  cronCards.append(card("Next Run", "No jobs configured"));
}

function renderSkills() {
  skillsCards.innerHTML = "";
  if (latestSkills.length === 0) {
    skillsCards.append(card("Skills", "No skills installed yet"));
    skillsCards.append(card("Install", "Use /skill install <name>"));
    return;
  }
  for (const skill of latestSkills) {
    skillsCards.append(card("Skill", skill));
  }
}

function renderConfig() {
  configCards.innerHTML = "";
  if (!latestOverview) {
    configCards.append(card("Config", lastApiError ? `No data (${lastApiError})` : "No data"));
    configCards.append(card("Hint", "Restart gateway and hard refresh dashboard (Ctrl+F5)"));
    return;
  }
  configCards.append(card("Gateway Port", String(latestOverview.gatewayPort)));
  configCards.append(card("Model", latestOverview.model));
  configCards.append(card("Auth", latestOverview.authMode));
  configCards.append(card("Memory", latestOverview.memory?.enabled ? latestOverview.memory.provider : "off"));
  configCards.append(card("Mem0 Key", latestOverview.memory?.envKeyLoaded ? "loaded from .env" : "not loaded"));
  configCards.append(card("Memory Entity", latestOverview.memory?.entity ?? "session-based"));
  configCards.append(card("Entity Lock", latestOverview.memory?.entityLocked ? "locked" : "not locked"));
  configCards.append(
    card("Last Memory Save", latestOverview.stats?.lastMemorySavedAt ? formatTime(latestOverview.stats.lastMemorySavedAt) : "none")
  );
  configCards.append(
    card(
      "Last Memory Event",
      latestOverview.stats?.lastMemoryEvent?.detail
        ? `${latestOverview.stats.lastMemoryEvent.status}: ${latestOverview.stats.lastMemoryEvent.detail}`
        : "none"
    )
  );
  configCards.append(card("Client ID", senderId));
}

function setView(viewName) {
  navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${viewName}`);
  });
  const meta = viewMeta[viewName] ?? viewMeta.chat;
  viewTitle.textContent = meta.title;
  viewSubtitle.textContent = meta.subtitle;
}

async function refreshData() {
  try {
    const health = await apiGet("/health");
    if (health.ok) {
      healthPill.textContent = "Health: OK";
      healthPill.classList.add("ok");
    } else {
      healthPill.textContent = "Health: degraded";
      healthPill.classList.remove("ok");
    }
  } catch {
    healthPill.textContent = "Health: unavailable";
    healthPill.classList.remove("ok");
  }

  let anyPanelLoaded = false;

  try {
    const overview = await apiGet("/api/overview");
    latestOverview = overview;
    anyPanelLoaded = true;
    lastApiError = "";
  } catch {
    lastApiError = "overview fetch failed";
    // keep previous overview
  }

  try {
    const sessions = await apiGet("/api/sessions");
    latestSessions = sessions.sessions ?? [];
    anyPanelLoaded = true;
  } catch {
    if (!lastApiError) lastApiError = "sessions fetch failed";
    // keep previous sessions
  }

  try {
    const skills = await apiGet("/api/skills");
    latestSkills = skills.skills ?? [];
    anyPanelLoaded = true;
  } catch {
    if (!lastApiError) lastApiError = "skills fetch failed";
    // keep previous skills
  }

  try {
    const instances = await apiGet("/api/instances");
    latestInstances = instances.instances ?? [];
    anyPanelLoaded = true;
  } catch {
    if (!lastApiError) lastApiError = "instances fetch failed";
    // keep previous instances
  }

  try {
    const docs = await apiGet("/api/workspace/docs");
    latestDocs = docs.docs ?? {};
    if (Object.keys(latestDocs).length > 0 && !latestDocs[activeDoc]) {
      activeDoc = Object.keys(latestDocs)[0];
    }
    setActiveDoc(activeDoc);
    anyPanelLoaded = true;
  } catch {
    if (!lastApiError) lastApiError = "workspace docs fetch failed";
    // keep previous docs
  }

  if (!anyPanelLoaded && !latestOverview) {
    healthPill.textContent = "Health: OK (limited)";
    healthPill.classList.add("ok");
  }
  renderOverview();
  renderChannels();
  renderSessions();
  renderInstances();
  renderCron();
  renderSkills();
  renderConfig();
}

function applyTheme() {
  const theme = localStorage.getItem(themeKey) ?? "dark";
  document.body.dataset.theme = theme;
  themeToggle.textContent = theme === "dark" ? "Dark mode" : "Light mode";
}

themeToggle.addEventListener("click", () => {
  const current = document.body.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(themeKey, current);
  applyTheme();
});

navItems.forEach((item) => {
  item.addEventListener("click", () => setView(item.dataset.view ?? "chat"));
});

docTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const next = tab.dataset.doc ?? "SOUL.md";
    setActiveDoc(next);
  });
});

docSave.addEventListener("click", async () => {
  docStatus.textContent = "Saving...";
  try {
    await fetch(`/api/workspace/docs/${encodeURIComponent(activeDoc)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify({ content: docEditor.value })
    });
    latestDocs[activeDoc] = docEditor.value;
    docStatus.textContent = `Saved ${activeDoc}`;
  } catch {
    docStatus.textContent = `Failed to save ${activeDoc}`;
  }
});

ws.addEventListener("open", () => {});

ws.addEventListener("close", () => {
  pendingTypingNode = null;
  appendMessage("Disconnected from gateway.", "assistant");
});

ws.addEventListener("message", (event) => {
  const payload = JSON.parse(event.data);
  if (payload.type === "assistant") {
    assistantRenderQueue = assistantRenderQueue.then(() => renderAssistantMessage(payload.content));
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  appendMessage(text, "user");
  ensureTypingBubble();
  ws.send(JSON.stringify({ type: "message", content: text }));
  input.value = "";
});

applyTheme();
setView("chat");
refreshData();
setInterval(refreshData, 10000);
