import { buildLegacyTools } from "./agent/tools";
import { zodToJsonSchema } from "zod-to-json-schema";
import { registerRouter } from "@/shared/messages";
import { getActiveSkills } from "./state";

export function installExternalTools() {
  const documentId = crypto.randomUUID();
  let queue = Promise.resolve();
  const tools = buildLegacyTools(true);
  const helpCache = new Map<string, Promise<any>>();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === "local" &&
      Object.keys(changes).some((k) => k.startsWith("xgoose.skills"))
    )
      helpCache.clear();
  });
  const version = async (value: unknown) =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            JSON.stringify([chrome.runtime.getManifest().version, value]),
          ),
        ),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    )
      .join("")
      .slice(0, 20);
  const catalog = tools.map((t) => ({
    name: t.name,
    description: t.definition.description,
    inputSchema: zodToJsonSchema(t.definition.inputSchema, {
      $refStrategy: "none",
    }),
  }));
  const catalogVersion = version(catalog);
  const changed = () =>
    Object.assign(
      new Error(
        "Page changed. Call list_tabs to inspect the current URL and refresh this session’s page binding.",
      ),
      {
        code: "page_changed",
        details: {
          currentUrl: location.href,
          executed: false,
          nextAction: "list_tabs",
        },
      },
    );
  registerRouter({
    "cs:external": async (request) => {
      if (request.op === "info")
        return {
          documentId,
          url: location.href,
          title: document.title,
          skills: getActiveSkills().map((s) => ({
            name: s.name,
            namespace: s.namespace,
          })),
        };
      if (request.op === "tools") {
        const revision = await catalogVersion;
        const key = request.name ? `${revision}:${request.name}` : revision;
        if (request.ifVersion === key) return { version: key, unchanged: true };
        if (request.name) {
          const tool = catalog.find((t) => t.name === request.name);
          if (!tool) throw Error(`Unknown page tool: ${request.name}`);
          return { version: key, tool };
        }
        return {
          version: key,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.definition.description
              .split(/(?<=[.!?])\s/)[0]
              .slice(0, 180),
          })),
        };
      }
      if (request.documentId !== documentId) throw changed();
      const run = queue.then(async () => {
        if (request.documentId !== documentId) throw changed();
        const tool = tools.find((t) => t.name === request.name);
        if (!tool) throw Error(`Unknown page tool: ${request.name}`);
        const input = tool.definition.inputSchema.parse(request.arguments);
        if (tool.name === "help") {
          const skill = getActiveSkills().find(
            (s) => s.name === input.skill || s.namespace === input.skill,
          );
          const revision = await version([
            skill ?? input.skill,
            input.function ?? null,
          ]);
          if (request.ifVersion === revision)
            return { result: { version: revision, unchanged: true } };
          let result = helpCache.get(revision);
          if (!result) {
            result = Promise.resolve(
              tool.definition.execute(input, { toolCallId: request.requestId }),
            );
            helpCache.set(revision, result);
            void result.then(
              (value) => {
                if (value?.ok === false) helpCache.delete(revision);
              },
              () => helpCache.delete(revision),
            );
          }
          return { result: { ...(await result), version: revision } };
        }
        const result = await tool.definition.execute(input, {
          toolCallId: request.requestId,
        });
        const parts = tool.definition.toModelOutput?.(result, input);
        return {
          result,
          content: parts?.map((p) =>
            p.type === "file-data"
              ? { type: "image", data: p.data, mimeType: p.mediaType }
              : p,
          ) ?? [{ type: "text", text: JSON.stringify(result) ?? "null" }],
        };
      });
      queue = run.then(
        () => {},
        () => {},
      );
      return run;
    },
  });
}
