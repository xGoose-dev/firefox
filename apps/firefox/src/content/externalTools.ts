import { buildLegacyTools } from "./agent/tools";
import { zodToJsonSchema } from "zod-to-json-schema";
import { registerRouter } from "@/shared/messages";

export function installExternalTools() {
  const documentId = crypto.randomUUID();
  let queue = Promise.resolve();
  const tools = buildLegacyTools(true);
  registerRouter({
    "cs:external": async (request) => {
      if (request.op === "info")
        return { documentId, url: location.href, title: document.title };
      if (request.op === "tools")
        return {
          documentId,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.definition.description,
            inputSchema: zodToJsonSchema(t.definition.inputSchema, {
              $refStrategy: "none",
            }),
          })),
        };
      if (request.documentId !== documentId)
        throw new Error(
          "Document changed. Discover the current document before calling tools.",
        );
      const run = queue
        .catch(() => {})
        .then(async () => {
          if (request.documentId !== documentId)
            throw new Error("Document changed");
          const tool = tools.find((t) => t.name === request.name);
          if (!tool) throw new Error(`Unknown page tool: ${request.name}`);
          const input = tool.definition.inputSchema.parse(request.arguments);
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
