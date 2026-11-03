#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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
    properties: { sessionId: string, title: string },
    required: [],
  },
  end_session: { properties: { sessionId: string } },
  list_tabs: { properties: { sessionId: string } },
  open_tab: { properties: { sessionId: string, url: string } },
  navigate_tab: {
    properties: { sessionId: string, tabId: integer, url: string },
  },
  close_tab: { properties: { sessionId: string, tabId: integer } },
  list_page_tools: { properties: { sessionId: string, tabId: integer } },
  call_page_tool: {
    properties: {
      sessionId: string,
      tabId: integer,
      documentId: string,
      name: string,
      arguments: { type: "object" },
    },
  },
};
const descriptions = {
  start_session:
    "Create or resume this agent’s cross-tab transcript. Keep its sessionId for every call; each agent uses its own session.",
  end_session: "Finish the session after pending tools settle.",
  list_tabs: "List tabs and current controllable document IDs.",
  open_tab: "Open an http(s) URL in a background tab and wait for tools.",
  navigate_tab: "Navigate the specified tab and wait for the new document.",
  close_tab: "Close the specified tab.",
  list_page_tools:
    "Discover existing page and website skill tools and their JSON input schemas.",
  call_page_tool:
    "Execute a discovered tool on an exact tab and document. Results include text and images. Errors and unknown outcomes are never automatically replayed.",
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
      msg.error ? entry.reject(Error(msg.error)) : entry.resolve(msg.result);
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
    { name: "xgoose", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Use start_session once per agent/task, reuse its sessionId across all tabs, and end_session when finished. Never share session IDs between independent agents. Use list_tabs or open_tab, then list_page_tools to discover page tools; call_page_tool needs the current documentId. The browser panel can stay closed. Unknown outcomes must not be automatically replayed.",
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
        content: [{ type: "text", text: String(error.message ?? error) }],
      };
    }
  });
  await server.connect(new StdioServerTransport());
  process.stdin.on("end", () => {
    socket.close();
  });
}
