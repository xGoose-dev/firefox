/** Fixed product instructions, never taken from page content or model output. */
export function userScriptsSetup(id:string) {
 const detailsUrl=chrome.runtime.getURL("options.html");
 const guideUrl=chrome.runtime.getURL("onboarding.html");
 const steps=['Open xgoose Settings.','Click Enable User Scripts. In Firefox’s prompt, select Allow user scripts, then click Allow.','Return to the website and retry your request.'];
 return {detailsUrl,guideUrl,steps};
}
export function userScriptsReminder(id:string,builtinSite=false) {
 const {detailsUrl,guideUrl,steps}=userScriptsSetup(id);
 return `\n# Firefox website skills permission\nUser Scripts permission is currently OFF. Built-in skills ARE available through skill_call({skill,function,args}); read_page and page inspection also work. User-installed, edited or online-updated scripts and arbitrary js_exec cannot run until enabled. Prefer skill_call for built-in helpers, even when their authored instructions show JS invocation examples. Do not tell users that built-in skills require this toggle. ${builtinSite?'This page has working built-in skills. Do not proactively warn about User Scripts or ask the user to enable it. The optional reminder belongs in Settings. Explain the permission only if a concrete requested custom action actually fails because of it, or the user explicitly asks about this permission.':''} Do not retry permission failures or claim you read unavailable website content. If a requested operation is blocked, explain the limitation in the user's language. If you suggest enabling it, always include [Open xgoose extension settings](${detailsUrl}), [Setup guide](${guideUrl}), and these steps: ${steps.join(' ')} You may use read_page for currently visible content if it succeeds, or answer from the user's supplied content; clearly state the coverage limit and do not claim you read an entire thread.\n`;
}
