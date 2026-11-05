import { translate } from "./locale";

/** The preference stays independent from Firefox's optional data permission. */
export async function mountAnalyticsChoice({
  checkbox,
  status,
  button,
  enabled,
  onChange,
}: {
  checkbox: HTMLInputElement;
  status: HTMLElement;
  button: HTMLButtonElement;
  enabled: boolean;
  onChange?: (enabled: boolean) => Promise<void>;
}) {
  checkbox.checked = enabled;
  checkbox.disabled = false;
  const render = async () => {
    const allowed = await chrome.permissions.contains({
      data_collection: ["technicalAndInteraction"],
    } as any);
    button.hidden = !checkbox.checked || allowed;
    status.textContent = translate(
      !checkbox.checked
        ? "Usage analytics is off."
        : allowed
          ? "Firefox has allowed usage analytics."
          : "On in xgoose. Allow it in Firefox to start sharing.",
    );
  };
  const request = async () => {
    button.disabled = true;
    try {
      // Called directly from the click/change handler so Firefox sees the user gesture.
      await chrome.permissions.request({
        data_collection: ["technicalAndInteraction"],
      } as any);
      await render();
    } catch (error) {
      status.textContent = translate(
        "Firefox could not request permission. Try again.",
      );
      console.error("[xgoose] Analytics permission request failed", error);
    } finally {
      button.disabled = false;
    }
  };
  checkbox.addEventListener("change", () => {
    const choice = checkbox.checked;
    const permission = choice ? request() : Promise.resolve();
    void (async () => {
      await onChange?.(choice);
      await permission;
      if (!choice) await render();
    })().catch((error) => {
      status.textContent = translate(
        "Could not save your analytics preference. Try again.",
      );
      console.error("[xgoose] Analytics preference failed", error);
    });
  });
  button.addEventListener("click", () => void request());
  chrome.permissions.onAdded.addListener(() => void render());
  chrome.permissions.onRemoved.addListener(() => void render());
  await render();
}
