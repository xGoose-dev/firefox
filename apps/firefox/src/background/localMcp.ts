import { SettingsSchema } from "@/shared/types";
import { loadAll, getSettings } from "@/shared/storage";
import { getAccount } from "@/shared/account";
import { sessionCommand, journal, sessionEvents } from "./sessionDb";
import { flushTranscripts } from "./transcripts";
import { redactTranscript } from "@/shared/redact";
import { sendToTab } from "@/shared/messages";
let socket: WebSocket | undefined,
  retry: ReturnType<typeof setTimeout> | undefined,
  generation = 0;
const pending = new Map<string, Set<Promise<unknown>>>(),
  metadata = new Map<string, Promise<any>>();
const seen = new Map<string, Promise<any>>();
const ending = new Set<string>();
let recovered = false;
function edit(id: string, fn: (s: any) => void) {
  const next = (metadata.get(id) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const s = await sessionCommand({ op: "get", id });
      if (!s) throw Error("Unknown session");
      fn(s);
      s.updatedAt = Date.now();
      await sessionCommand({ op: "save", value: s });
      return s;
    });
  metadata.set(id, next);
  return next;
}
async function record(s: any, type: string, body: any = {}) {
  await journal(
    {
      id: crypto.randomUUID(),
      sessionId: s.id,
      runId: s.runId,
      provider: "external",
      ownerId: s.ownerId,
      at: Date.now(),
      event: redactTranscript({
        type,
        source: "mcp",
        client: s.client,
        ...body,
      }),
    },
    !!s.ownerId,
  );
  void flushTranscripts().catch(() => {});
}
async function page(tabId: number, request: any) {
  const r = await sendToTab(tabId, "cs:external", request);
  if (r?.__error)
    throw Object.assign(Error(r.__error), { code: r.code, details: r.details });
  return r;
}
async function bindPage(sessionId: string, tabId: number, info: any) {
  await edit(sessionId, (s) => {
    s.documents = { ...s.documents, [tabId]: info.documentId };
  });
}
function pageChanged(tabId: number, currentUrl?: string) {
  return Object.assign(
    Error(
      "Page changed. Call list_tabs to inspect the current URL and refresh this session’s page binding.",
    ),
    {
      code: "page_changed",
      details: { tabId, currentUrl, executed: false, nextAction: "list_tabs" },
    },
  );
}
async function boundDocument(
  sessionId: string,
  tabId: number,
  explicit?: string,
) {
  const info = await page(tabId, { op: "info" });
  const current = await sessionCommand({ op: "get", id: sessionId });
  const expected = explicit ?? current.documents?.[tabId];
  if (expected && expected !== info.documentId)
    throw pageChanged(tabId, info.url);
  if (!expected) await bindPage(sessionId, tabId, info);
  return info.documentId;
}
async function listTabs(sessionId: string) {
  const tabs = await Promise.all(
    (await chrome.tabs.query({})).map(async (tab) => {
      let info;
      try {
        info = await page(tab.id!, { op: "info" });
      } catch {}
      return {
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        controllable: !!info,
        skills: info?.skills ?? [],
        documentId: info?.documentId,
      };
    }),
  );
  await edit(sessionId, (s) => {
    s.documents = Object.fromEntries(
      tabs.filter((t) => t.documentId).map((t) => [t.tabId, t.documentId]),
    );
  });
  return tabs.map(({ documentId, ...tab }) => tab);
}
async function ready(tabId: number, previous?: string) {
  for (let i = 0; i < 100; i++) {
    if (!getSettings().localMcpEnabled)
      throw Error("Local MCP control disabled");
    try {
      const info = await page(tabId, { op: "info" });
      if (info.documentId !== previous) return info;
    } catch {
      await chrome.tabs.get(tabId);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { status: "not_ready", documentId: null };
}
function url(value: string) {
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol))
    throw Error("Open an http(s) URL");
  return u.href;
}
async function dispatch(request: any): Promise<any> {
  if (!getSettings().localMcpEnabled) throw Error("Local MCP control disabled");
  const a = request.args,
    id = a.sessionId;
  if (request.name === "start_session") {
    const account = await getAccount();
    let s = id ? await sessionCommand({ op: "get", id }) : null;
    if (id && !s) throw Error("Unknown session");
    if (s && (s.source !== "mcp" || s.ownerId !== account?.user.id))
      throw Error("Session belongs to another account or source");
    if (!s) {
      s = {
        id: crypto.randomUUID(),
        source: "mcp",
        client: request.client ?? "External MCP",
        ownerId: account?.user.id,
        title: a.title ?? "MCP session",
        origin: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        sites: [],
        callCount: 0,
      };
    }
    if (s.status !== "active") {
      s.runId = crypto.randomUUID();
      s.status = "active";
      await sessionCommand({ op: "save", value: s });
      await record(s, "run-start");
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            sessionId: s.id,
            status: s.status,
            ...(a.includeTabs ? { tabs: await listTabs(s.id) } : {}),
          }),
        },
      ],
    };
  }
  const s = await sessionCommand({ op: "get", id });
  const account = await getAccount();
  if (!s || s.source !== "mcp" || s.ownerId !== account?.user.id)
    throw Error("Start a session for the current account first");
  if (request.name === "end_session") {
    await Promise.allSettled([...(pending.get(id) ?? [])]);
    await edit(id, (v) => {
      v.status = "completed";
    });
    await record(s, "run-end", { outcome: "completed" });
    return { content: [{ type: "text", text: "Session completed" }] };
  }
  if (s.status !== "active")
    throw Error("Resume the session before calling tools");
  const execute = async () => {
    const previous = (await sessionEvents(id)).find(
      (e) => e.event.requestId === request.id,
    );
    if (previous)
      throw Error(
        "Request already received. Inspect history; operation was not replayed.",
      );
    let target: any;
    if (a.tabId !== undefined)
      target = { tabId: a.tabId, documentId: a.documentId };
    await edit(id, (v) => {
      v.callCount++;
      if (target?.site && !v.sites.includes(target.site))
        v.sites.push(target.site);
    });
    await record(s, "tool-call", {
      requestId: request.id,
      toolCallId: request.id,
      toolName: request.name,
      input: a,
      ...target,
    });
    try {
      let result: any, content: any;
      if (a.tabId !== undefined) {
        const tab = await chrome.tabs.get(a.tabId);
        target = {
          ...target,
          url: tab.url,
          site:
            tab.url && /^https?:/.test(tab.url)
              ? new URL(tab.url).hostname
              : undefined,
        };
      }
      switch (request.name) {
        case "list_tabs":
          result = await listTabs(id);
          break;
        case "open_tab": {
          const tab = await chrome.tabs.create({
            url: url(a.url),
            active: false,
          });
          result = { tabId: tab.id, ...(await ready(tab.id!)) };
          if (result.documentId) await bindPage(id, tab.id!, result);
          target = { tabId: tab.id, site: new URL(a.url).hostname, ...result };
          break;
        }
        case "navigate_tab": {
          const previous = await page(a.tabId, { op: "info" });
          await chrome.tabs.update(a.tabId, { url: url(a.url) });
          result = {
            tabId: a.tabId,
            ...(await ready(a.tabId, previous.documentId)),
          };
          if (result.documentId) await bindPage(id, a.tabId, result);
          target = { ...target, ...result, site: new URL(a.url).hostname };
          break;
        }
        case "close_tab":
          await chrome.tabs.remove(a.tabId);
          result = { closed: true, tabId: a.tabId };
          await edit(id, (v) => {
            if (v.documents) delete v.documents[a.tabId];
          });
          break;
        case "list_page_tools":
          const info = await page(a.tabId, { op: "info" });
          await bindPage(id, a.tabId, info);
          result = await page(a.tabId, {
            op: "tools",
            name: a.name,
            ifVersion: a.ifVersion,
          });
          break;
        case "call_skill":
        case "help_skill":
        case "call_page_tool": {
          const documentId = await boundDocument(id, a.tabId, a.documentId);
          target.documentId = documentId;
          const name =
            request.name === "call_skill"
              ? "skill_call"
              : request.name === "help_skill"
                ? "help"
                : a.name;
          const args =
            request.name === "call_skill"
              ? {
                  skill: a.skill,
                  function: a.function,
                  args: a.args ?? {},
                  timeoutMs: a.timeoutMs,
                }
              : request.name === "help_skill"
                ? { skill: a.skill, function: a.function }
                : a.arguments;
          const out = await page(a.tabId, {
            op: "call",
            documentId,
            name,
            arguments: args,
            ifVersion: a.ifVersion,
            requestId: request.id,
          });
          result = out.result;
          content = out.content;
          break;
        }
        default:
          throw Error("Unknown MCP tool");
      }
      if (target?.site)
        await edit(id, (v) => {
          if (!v.sites.includes(target.site)) v.sites.push(target.site);
        });
      await record(s, "tool-result", {
        requestId: request.id,
        toolCallId: request.id,
        toolName: request.name,
        output: result,
        ...target,
      });
      if (["open_tab", "navigate_tab"].includes(request.name)) {
        const { documentId, ...view } = result;
        result = view;
      }
      return {
        content: content ?? [
          { type: "text", text: JSON.stringify(result) ?? "null" },
        ],
      };
    } catch (error) {
      await record(s, "tool-error", {
        requestId: request.id,
        toolCallId: request.id,
        toolName: request.name,
        error: String(error),
        code: (error as any)?.code,
        details: (error as any)?.details,
        ...target,
      });
      throw error;
    }
  };
  return execute();
}
async function disconnect() {
  for (const s of await sessionCommand({ op: "list" })) {
    if (s.source === "mcp" && s.status === "active") {
      await edit(s.id, (v) => {
        v.status = "interrupted";
      });
      await record(s, "run-interrupted", {
        reason: "mcp_disconnected",
        outcome: "unknown",
      });
    }
  }
}
export async function connectLocalMcp() {
  const g = ++generation;
  clearTimeout(retry);
  const old = socket;
  socket = undefined;
  old?.close();
  await loadAll();
  if (!recovered) {
    recovered = true;
    await disconnect();
  }
  const settings = SettingsSchema.parse(
    (await chrome.storage.local.get("xgoose.settings"))["xgoose.settings"] ??
      {},
  );
  if (!settings.localMcpEnabled) {
    await disconnect();
    await chrome.storage.local.set({ "xgoose.mcp.status": "Disabled" });
    return;
  }
  let connected = false;
  const ws = new WebSocket(`ws://127.0.0.1:${settings.localMcpPort}/browser`);
  socket = ws;
  ws.onopen = () => {
    connected = true;
    void chrome.storage.local.set({ "xgoose.mcp.status": "Connected" });
  };
  ws.onmessage = (event) => {
    const req = JSON.parse(event.data);
    if (req.name === "start_session") ending.delete(req.args.sessionId);
    else if (req.name === "end_session") ending.add(req.args.sessionId);
    else if (ending.has(req.args.sessionId)) {
      ws.send(
        JSON.stringify({
          id: req.id,
          error:
            "Session is ending. Start or resume a session before issuing more calls.",
        }),
      );
      return;
    }

    let work = seen.get(req.id);
    if (!work) {
      work = Promise.resolve().then(() => dispatch(req));
      seen.set(req.id, work);
      if (!["start_session", "end_session"].includes(req.name)) {
        const set = pending.get(req.args.sessionId) ?? new Set();
        pending.set(req.args.sessionId, set);
        set.add(work);
        void work.finally(() => set.delete(work!)).catch(() => {});
      }
    }
    void work.then(
      (result) => {
        if (ws.readyState === 1)
          ws.send(JSON.stringify({ id: req.id, result }));
      },
      (error) => {
        if (ws.readyState === 1)
          ws.send(
            JSON.stringify({
              id: req.id,
              error: error.code
                ? { code: error.code, message: error.message, ...error.details }
                : String(error.message ?? error),
            }),
          );
      },
    );
  };
  ws.onclose = () => {
    if (g !== generation) return;
    void chrome.storage.local.set({
      "xgoose.mcp.status": "Disconnected — waiting for Codex",
    });
    if (connected) void disconnect();
    retry = setTimeout(() => void connectLocalMcp(), 2000);
  };
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes["xgoose.settings"]) {
    const o: any = changes["xgoose.settings"].oldValue,
      n: any = changes["xgoose.settings"].newValue;
    if (
      o?.localMcpEnabled !== n?.localMcpEnabled ||
      o?.localMcpPort !== n?.localMcpPort
    )
      void connectLocalMcp();
  }
});
void connectLocalMcp();
