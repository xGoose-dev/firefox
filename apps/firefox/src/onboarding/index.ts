import {mountAccountSection} from "@/shared/accountSection";
import {initializeLocale,mountAnswerLanguage} from "@/shared/locale";
void initializeLocale(document.body);
import {send} from "@/shared/messages";
import {onAccountChange} from "@/shared/account";
import {SettingsSchema,getProviderApiKey} from "@/shared/types";
import {track,setAnalyticsActive} from "@/shared/analytics";
let permissionKnown:boolean|undefined;
setAnalyticsActive(true);
track("onboarding_viewed");
async function checkPermission() {
  const status = document.querySelector<HTMLElement>("#permissionState")!;
  const step = document.querySelector<HTMLDetailsElement>("#permissionStep")!;
  const badge = document.querySelector<HTMLElement>("#permissionBadge")!;
  try {
    await chrome.userScripts.getScripts();
    if(permissionKnown!==true){track("permission_enabled",{step:"user_scripts"});permissionKnown=true;}
    status.textContent = "Enabled. Built-in and user-installed skills are ready.";
    status.classList.add("saved");
    badge.textContent = "✓ Enabled";
    badge.classList.add("enabled");
    const restoreFocus = step.contains(document.activeElement);
    step.open = false;
    if (restoreFocus) document.querySelector<HTMLElement>("#permissionStepSummary")!.focus();
  } catch {
    if(permissionKnown!==false){track("permission_blocked",{step:"user_scripts",reason:"permission"});permissionKnown=false;}
    status.textContent = "Built-in skills are ready. Enable the optional User Scripts permission for custom scripts, then check again.";
    status.classList.remove("saved");
    badge.textContent = "Optional";
    badge.classList.remove("enabled");
    // Leave the optional section closed until the user chooses custom scripts.
  }
}
const detailsUrl = chrome.runtime.getURL("options.html");
document.querySelector("#extensionDetailsUrl")!.textContent = detailsUrl;

document.querySelector("#openExtensions")!.addEventListener("click", async () => {
  const button=document.querySelector<HTMLButtonElement>("#openExtensions")!;
  button.disabled=true;
  try {
    const granted = await chrome.permissions.request({permissions:['userScripts']});
    track(granted ? "permission_enabled" : "permission_blocked", {step:"user_scripts"});
    await checkPermission();
  } catch {
    document.querySelector("#permissionState")!.textContent="Firefox could not enable User Scripts. Try again; built-in skills are still available.";
  } finally { button.disabled=false; }
});
document.querySelector("#checkPermission")!.addEventListener("click", () => void checkPermission());
window.addEventListener("focus", () => void checkPermission());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkPermission();
});
void checkPermission();

document.querySelectorAll<HTMLAnchorElement>("[data-start-site]").forEach(link=>link.addEventListener("click",()=>track("onboarding_website_opened",{target:link.dataset.startSite!})));

void mountAccountSection().catch(()=>{document.querySelector("#accountState")!.textContent="Sign-in could not load. Open Settings to try again.";});
void mountAnswerLanguage(document.querySelector<HTMLSelectElement>("#answerLanguage")!,document.querySelector<HTMLElement>("#answerLanguageStatus"),{syncInterface:true});

let connectionGeneration=0;
async function refreshConnection() {
  const generation=++connectionGeneration;
  const status=document.querySelector<HTMLElement>('#connectionState')!;
  const claim=document.querySelector<HTMLButtonElement>('#claimTrial')!;
  const next=document.querySelector<HTMLAnchorElement>('#tryWebsite')!;
  claim.hidden=true;next.hidden=true;
  try {
    const saved=await chrome.storage.local.get('xgoose.settings');
    const settings=SettingsSchema.parse(saved['xgoose.settings']??{});
    if(generation!==connectionGeneration)return;
    if(settings.provider!=='xgoose-hosted') {
      document.querySelector<HTMLDetailsElement>('#hostedSignIn')!.open=false;
      const configured=!!getProviderApiKey(settings);
      status.textContent=configured?'Your own provider is configured. Open a website to try your first conversation.':'Connect your API key in Settings, then return here to try a website.';
      next.hidden=!configured;return;
    }
    const account=await send('sw:account_get',undefined);
    if(generation!==connectionGeneration)return;
    if(!account){status.textContent='Sign in with email for Hosted AI, or connect your own API key without signing in.';return;}
    const state=await send('sw:hosted_status',{});
    if(generation!==connectionGeneration)return;
    claim.hidden=!state.quota.claimable;
    const balance=new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2}).format(state.quota.remaining_micros/1e6);
    status.textContent=state.blocker??`Hosted AI is ready. ${balance} credit available. Open a website to start.`;
    next.hidden=!!state.blocker;
  }catch {if(generation===connectionGeneration)status.textContent='Could not check your connection. Open Settings to test it or choose your own provider.';}
}
document.querySelector<HTMLButtonElement>('#claimTrial')!.addEventListener('click',async event=>{
  const button=event.currentTarget as HTMLButtonElement;button.disabled=true;
  try{await send('sw:hosted_status',{claim:true});await refreshConnection();}
  catch{document.querySelector('#connectionState')!.textContent='Credit could not be claimed. Try again or connect your own provider in Settings.';}
  finally{button.disabled=false;}
});
onAccountChange(()=>void refreshConnection());
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes['xgoose.settings'])void refreshConnection();});
window.addEventListener('focus',()=>void refreshConnection());
void refreshConnection();
