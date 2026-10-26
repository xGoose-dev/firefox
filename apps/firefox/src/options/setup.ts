import {track,failureReason} from "@/shared/analytics";
import { send } from "@/shared/messages";
import { onAccountChange } from "@/shared/account";

export function mountSetup(): void {
  const host = document.querySelector("#section-account")!;
  const setup = document.createElement("div");
  setup.className = "hosted-setup";
  setup.innerHTML = `<div class="setup-credit"><div><strong>Free hosted credit</strong><p id="creditStatus" class="hint" role="status">Sign in to check your trial credit.</p></div><button id="claimTrial" class="btn secondary" hidden>Claim free trial credit</button></div>`;
  host.append(setup);
  const claim = setup.querySelector<HTMLButtonElement>("#claimTrial")!;
  const credit = setup.querySelector<HTMLElement>("#creditStatus")!;
  let generation = 0;
  async function refresh() {
    const current = ++generation;
    claim.hidden = true;
    try {
      const state = await send("sw:hosted_status", {});
      if (current !== generation) return;
      claim.hidden = !state.quota.claimable;
      credit.textContent = state.quota.granted_micros
        ? `$${(state.quota.remaining_micros / 1e6).toFixed(2)} remaining${state.quota.expires_at ? ` · expires ${new Date(state.quota.expires_at).toLocaleDateString()}` : ""}. ${state.blocker ?? "Ready to use."}`
        : state.quota.claimable ? "Your free trial is available. Claim it here to activate Hosted AI." : "Trial claims are currently paused.";
    } catch (error) {
      if (current !== generation) return;
      credit.textContent = error instanceof Error ? error.message : String(error);
    }
  }
  claim.addEventListener("click", async () => {
    claim.disabled = true;
    const started=Date.now();track("trial_claim_started");
    try { await send("sw:hosted_status", {claim:true}); track("trial_claim_succeeded",{duration_ms:Date.now()-started}); await refresh(); }
    catch (error) { track("trial_claim_failed",{reason:failureReason(error),duration_ms:Date.now()-started});credit.textContent = String(error); }
    finally { claim.disabled = false; }
  });
  onAccountChange(() => void refresh());
  void refresh();

  const banner=document.createElement("aside");
  banner.id="userScriptsAlert";banner.className="user-scripts-alert";banner.hidden=true;banner.setAttribute("role","alert");
  banner.innerHTML=`<strong>Enable custom scripts and advanced actions</strong><p>Allow User Scripts is off. Built-in skills and page reading are ready to use. Enable it to run community skills, edited or online-updated skills, and custom JavaScript actions.</p><div class="permission-actions"><button type="button" class="btn primary compact" id="enableUserScripts">Enable User Scripts</button><a href="onboarding.html">See setup steps</a><button type="button" class="btn secondary compact" id="recheckUserScripts">Check again</button></div><p class="hint">Click Enable User Scripts and approve Firefox’s permission prompt. Return to your website and retry.</p>`;
  document.querySelector(".layout")!.before(banner);
  banner.querySelector("#enableUserScripts")!.addEventListener("click",async()=>{track("permission_settings_opened",{page:"settings"});try{await chrome.permissions.request({permissions:["userScripts"]});await checkPermission();}catch{banner.querySelector("p")!.textContent=`Open xgoose Settings, then enable the optional User Scripts permission.`;}});
  banner.querySelector("#recheckUserScripts")!.addEventListener("click",()=>void checkPermission());
  const permissions = document.createElement("div");
  permissions.className = "permission-status";
  permissions.innerHTML = `<div><strong>Allow User Scripts</strong><p class="hint" id="userScriptsStatus">Checking Firefox permission…</p></div><div class="permission-actions"><button id="openUserScriptsSettings" class="btn secondary compact" type="button">Enable User Scripts</button><a href="onboarding.html">Show me where</a></div>`;
  document.querySelector("#section-skills .hint")!.after(permissions);
  permissions.querySelector("#openUserScriptsSettings")!.addEventListener("click", async () => {
    try { await chrome.permissions.request({permissions:["userScripts"]});await checkPermission(); }
    catch { permissions.querySelector("#userScriptsStatus")!.textContent = "Firefox did not enable User Scripts. Select Show me where for the setup steps."; }
  });
  async function checkPermission() {
    let enabled = false;
    try { await chrome.userScripts.getScripts(); enabled = true; } catch { /* permission disabled */ }
    banner.hidden=enabled;
    permissions.querySelector("#userScriptsStatus")!.textContent = enabled
      ? "Enabled. Built-in and user-installed skills are ready."
      : "Built-in skills work now. Enable the optional User Scripts permission to run custom scripts.";
  }
  window.addEventListener("focus", () => void checkPermission());
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")void checkPermission();});
  void checkPermission();
}
