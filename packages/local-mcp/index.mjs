#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { WebSocket, WebSocketServer } from "ws";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
const packageInfo = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`xgoose-mcp ${packageInfo.version}

Usage: xgoose-mcp [--port 8765]

Connect Codex in one command:
  codex mcp add xgoose -- npx --yes xgoose-mcp@next --port 8765

Or install globally:
  npm install -g xgoose-mcp@next

Enable Local MCP control in the Firefox extension with the same port.
The stdio server starts the shared local bridge automatically.

Options:
  --port <number>  Local bridge port (default: 8765)
  --version       Print package version
  --help          Print this help`);
  process.exit(0);
}
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(packageInfo.version);
  process.exit(0);
}
const port = Number(
  process.argv.includes("--port")
    ? process.argv[process.argv.indexOf("--port") + 1]
    : 8765,
);
const endpoint = `http://127.0.0.1:${port}`;
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("Invalid port");
const string = { type: "string" },
  integer = { type: "integer" };
const specs = {
  start_session: {
    properties: {
      sessionId: string,
      title: string,
      includeTabs: { type: "boolean" },
    },
    required: [],
  },
  end_session: { properties: { sessionId: string } },
  list_tabs: { properties: { sessionId: string } },
  open_tab: { properties: { sessionId: string, url: string } },
  navigate_tab: {
    properties: { sessionId: string, tabId: integer, url: string },
  },
  close_tab: { properties: { sessionId: string, tabId: integer } },
  list_page_tools: {
    properties: {
      sessionId: string,
      tabId: integer,
      name: string,
      ifVersion: string,
    },
    required: ["sessionId", "tabId"],
  },
  help_skill: {
    properties: {
      sessionId: string,
      tabId: integer,
      skill: string,
      function: string,
      ifVersion: string,
    },
    required: ["sessionId", "tabId", "skill"],
  },
  call_skill: {
    properties: {
      sessionId: string,
      tabId: integer,
      skill: string,
      function: string,
      args: { type: "object" },
      timeoutMs: integer,
    },
    required: ["sessionId", "tabId", "skill", "function"],
  },
  call_page_tool: {
    properties: {
      sessionId: string,
      tabId: integer,
      documentId: string,
      name: string,
      arguments: { type: "object" },
    },
    required: ["sessionId", "tabId", "name", "arguments"],
  },
};
const descriptions = {
  start_session:
    "Create or resume this agent’s cross-tab transcript. Set includeTabs:true to receive a compact tab list in the same call. Keep the returned sessionId for all calls by this agent.",
  end_session: "Finish the session after pending tools settle.",
  list_tabs:
    "List tab IDs, URLs, titles and active skill names. Also refresh this session’s page bindings after navigation.",
  open_tab: "Open an http(s) URL in a background tab and wait for tools.",
  navigate_tab: "Navigate the specified tab and wait for the new document.",
  close_tab: "Close the specified tab.",
  help_skill:
    "Describe a website skill. Omit function for a short name/summary directory; provide function for only that function’s full input schema. Cache by returned version; reuse known schemas instead of calling help every time. ifVersion returns unchanged when already known.",
  call_skill:
    "Call a website skill directly on tabId: skill, function, args. No documentId or nested skill_call wrapper is needed. Reuse known function arguments; help_skill is only needed for unfamiliar functions.",
  list_page_tools:
    "Compact page-tool directory by default. Provide name to retrieve one full input schema. Reuse known schemas, or pass ifVersion for a conditional response.",
  call_page_tool:
    "Execute a page tool on tabId. Document binding is managed by the bridge; documentId is an optional legacy override. Use call_skill for website functions. Results include text and images.",
};
if (process.argv.includes("--broker")) {
  const clients = new Set(),
    pending = new Map();
  let browser, idle;
  const schedule = () => {
    clearTimeout(idle);
    if (!clients.size) idle = setTimeout(() => process.exit(0), 60000);
  };
  schedule();
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ service: "xgoose-local-mcp", version: 1 }));
  });
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket, req) => {
    const isBrowser = req.url === "/browser";
    if (
      isBrowser
        ? !req.headers.origin?.startsWith("moz-extension://")
        : !!req.headers.origin
    ) {
      socket.close(1008, "Extension or local MCP clients only");
      return;
    }
    if (isBrowser) {
      if (browser) {
        socket.close(1008, "A Firefox profile is already connected");
        return;
      }
      browser = socket;
    } else {
      clients.add(socket);
      schedule();
    }
    socket.on("message", (data) => {
      const msg = JSON.parse(String(data));
      if (isBrowser) {
        const target = pending.get(msg.id);
        if (target) {
          pending.delete(msg.id);
          if (target.readyState === WebSocket.OPEN)
            target.send(JSON.stringify(msg));
        }
      } else if (browser?.readyState === WebSocket.OPEN) {
        pending.set(msg.id, socket);
        browser.send(JSON.stringify(msg));
      } else
        socket.send(
          JSON.stringify({
            id: msg.id,
            error:
              "Firefox is not connected. Enable Local MCP control in Advanced settings.",
          }),
        );
    });
    socket.on("close", () => {
      if (isBrowser) {
        browser = undefined;
        for (const [id, target] of pending) {
          if (target.readyState === WebSocket.OPEN)
            target.send(
              JSON.stringify({
                id,
                error:
                  "Firefox disconnected; execution outcome unknown. Operation was not replayed.",
              }),
            );
        }
        pending.clear();
      } else {
        clients.delete(socket);
        for (const [id, target] of pending)
          if (target === socket) pending.delete(id);
        schedule();
      }
    });
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") process.exit(0);
    throw error;
  });
  server.listen(port, "127.0.0.1");
} else {
  let launched = false;
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(300),
      });
      const info = await response.json();
      if (info.service !== "xgoose-local-mcp" || info.version !== 1)
        throw Error("Port occupied by another service");
      break;
    } catch (error) {
      if (String(error).includes("Port occupied")) throw error;
      if (!launched) {
        spawn(
          process.execPath,
          [fileURLToPath(import.meta.url), "--broker", "--port", String(port)],
          { detached: true, stdio: "ignore" },
        ).unref();
        launched = true;
      }
      if (i === 49) throw Error("Local MCP bridge could not start");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const socket = new WebSocket(`ws://127.0.0.1:${port}/client`),
    waiting = new Map();
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.on("message", (data) => {
    const msg = JSON.parse(String(data)),
      entry = waiting.get(msg.id);
    if (entry) {
      clearTimeout(entry.timer);
      waiting.delete(msg.id);
      msg.error
        ? entry.reject(
            typeof msg.error === "string"
              ? Error(msg.error)
              : Object.assign(Error(msg.error.message), { detail: msg.error }),
          )
        : entry.resolve(msg.result);
    }
  });
  socket.on("close", () => {
    for (const e of waiting.values()) {
      clearTimeout(e.timer);
      e.reject(Error("Bridge disconnected; outcome unknown. Not replayed."));
    }
    waiting.clear();
  });
  const server = new Server(
    { name: "xgoose", version: packageInfo.version },
    {
      capabilities: { tools: {} },
      instructions:
        "Start one session per agent/task with includeTabs:true to get the sessionId and compact tab list together. Reuse that sessionId across tabs, then end_session. For website functions use call_skill(tabId,skill,function,args) directly. Known tools and function schemas can be reused without discovery. For unfamiliar functions use help_skill with a specific function; omitting function returns only a compact directory. Cache descriptions by version and use ifVersion when checking for changes. list_page_tools is optional: it returns a compact directory, or one full schema when name is specified. Document IDs are managed internally. On page_changed, inspect currentUrl and refresh with list_tabs before continuing. Reuse existing tabs; open_tab creates background pages, navigate_tab changes their URL, close_tab cleans up temporary task pages. The panel can stay closed. Unknown execution outcomes are not automatically replayed.",
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(specs).map(([name, s]) => ({
      name,
      description: descriptions[name],
      inputSchema: {
        type: "object",
        ...s,
        required: s.required ?? Object.keys(s.properties),
        additionalProperties: false,
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(Error("Tool timed out; outcome unknown. Not replayed."));
        }, 630000);
        waiting.set(id, { resolve, reject, timer });
        socket.send(
          JSON.stringify({
            id,
            name: request.params.name,
            client: server.getClientVersion()?.name ?? "External MCP",
            args: request.params.arguments ?? {},
          }),
        );
      });
      return result;
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error.detail
              ? JSON.stringify(error.detail)
              : String(error.message ?? error),
          },
        ],
        ...(error.detail ? { structuredContent: { error: error.detail } } : {}),
      };
    }
  });
  await server.connect(new StdioServerTransport());
  process.stdin.on("end", () => {
    socket.close();
  });
}
