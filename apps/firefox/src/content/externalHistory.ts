import { send } from "@/shared/messages";
export async function externalHistory(
  session: any,
  download = false,
  panel?: import("@xgoose/ui").Panel,
) {
  const events = await send("sw:session", { op: "events", id: session.id });
  if (download) {
    const text =
      `# ${session.title}\n\nStatus: ${session.status}\n\n` +
      events
        .map(
          (e: any) =>
            `## ${new Date(e.at).toISOString()} · ${e.event.type}\n\n\`\`\`json\n${JSON.stringify(e.event, null, 2)}\n\`\`\`\n`,
        )
        .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    a.download = `mcp-${session.id}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }
  const root = document.querySelector("#xgoose-root")!.shadowRoot!;
  root.querySelector(".mcp-history-detail")?.remove();
  const view = document.createElement("div");
  view.className = "mcp-history-detail";
  view.style.cssText =
    "position:fixed;right:16px;top:48px;width:min(560px,90vw);max-height:80vh;overflow:auto;background:Canvas;color:CanvasText;border:1px solid #888;border-radius:12px;padding:16px;z-index:2147483647;font:14px system-ui;box-shadow:0 4px 30px #0004";
  const close = document.createElement("button");
  close.textContent = "Close history";
  close.onclick = () => view.remove();
  view.append(close);
  const title = document.createElement("h3");
  title.textContent = `${session.title} · ${session.status} · ${session.sites?.length ?? 0} pages`;
  view.append(title);
  const cards = new Map<string, any>();
  for (const row of events) {
    const event = row.event;
    if (panel && event.type === "tool-call") {
      const label = document.createElement("p");
      label.textContent = `${new Date(row.at).toLocaleTimeString()} · ${event.site ?? event.toolName}`;
      view.append(label);
      cards.set(
        event.requestId,
        panel.createHistoryToolCard(
          event.input?.name ?? event.toolName,
          event.input?.arguments ?? event.input,
          view,
        ),
      );
    }
    if (
      cards.has(event.requestId) &&
      ["tool-result", "tool-error"].includes(event.type)
    )
      cards.get(event.requestId).setResult(event.output, event.error);
    const details = document.createElement("details"),
      summary = document.createElement("summary"),
      body = document.createElement("pre");
    summary.textContent = `${new Date(row.at).toLocaleTimeString()} · ${row.event.toolName ?? row.event.type} · ${row.event.site ?? ""}`;
    body.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere";
    body.textContent = JSON.stringify(row.event, null, 2);
    details.append(summary, body);
    view.append(details);
  }
  if(session.status === "interrupted")for(const card of cards.values())if(card.el.classList.contains("running"))card.setResult(undefined,"Connection interrupted; execution outcome unknown. Not replayed.");
  root.append(view);
}
