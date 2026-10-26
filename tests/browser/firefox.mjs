import {Builder, By, until} from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {mkdir, writeFile, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const requests=[];
let contextFixture=null;
const server=createServer(async(req,res)=>{
 if(req.url.includes('/chat/completions')){
  let data='';for await(const b of req)data+=b;requests.push(JSON.parse(data));
  if(contextFixture){
   const request=requests.at(-1),summary=data.includes('Summarize this browser-agent history');
   if(summary)contextFixture.summaries++;
   else contextFixture.normal++;
   if(!summary&&contextFixture.reject&&contextFixture.normal===1){
    res.writeHead(400,{'content-type':'application/json','x-xgoose-context-target-tokens':'32000'});
    res.end(JSON.stringify({error:{code:'context_length_exceeded',message:'Maximum context length exceeded. Compact and retry.'}}));return;
   }
   if(!summary)contextFixture.sent=request;
   const text=summary?'Earlier evidence summarized. Preserve FINAL_GOAL. Never replay completed actions.':`Context fixture ${contextFixture.name} completed.`;
   const frame=(delta,finish=null)=>'data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})+'\n\n';
   res.writeHead(200,{'content-type':'text/event-stream'});
   res.end(frame({role:'assistant',content:text})+frame({},'stop')+'data: [DONE]\n\n');return;
  }
  const i=requests.length;
  const delta=i===1?{tool_calls:[{index:0,id:'read-fixture',type:'function',function:{name:'read_page',arguments:JSON.stringify({format:'text'})}}]}:{content:'Firefox research complete. The page explains how xgoose brings AI research, website skills and images into your current tab. Your provider stays under your control. [Read the source]('+base+'/article)'};
  res.writeHead(200,{'content-type':'text/event-stream'});
  const frame=(delta,finish=null)=>'data: '+JSON.stringify({id:'fixture-'+i,object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n';
  res.write(frame({role:'assistant',...delta}));res.write(frame({},i===1?'tool_calls':'stop'));res.end('data: [DONE]\n\n');return;
 }
 res.setHeader('content-type','text/html; charset=utf-8');
 res.end('<!doctype html><html lang="en"><head><title>xgoose · Firefox research</title><style>body{font:18px/1.7 system-ui;background:#faf8f4;color:#223030;max-width:720px;margin:70px 8vw}small{color:#697b68}h1{font-size:48px;line-height:1.12}p{max-width:580px}.tag{border:1px solid #bbc8b3;border-radius:24px;padding:6px 16px;display:inline-block}</style></head><body><small>XGOOSE · PRODUCT NOTES</small><h1>Research the web.<br>Keep your place.</h1><p>xgoose brings AI research, website skills and images into your current tab. Ask about the page, explore its sources, and keep your provider under your control.</p><p>Built-in skills work immediately. Community scripts are optional and need your explicit permission.</p><p class="tag">Firefox edition</p><p><small>Local demonstration used for automated extension testing.</small></p></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
await mkdir('artifacts/firefox-e2e',{recursive:true});
await rm('artifacts/firefox-e2e/report.json',{force:true});
const binary=process.env.FIREFOX_BINARY||(existsSync('artifacts/firefox-runtime/Firefox.app')?resolve('artifacts/firefox-runtime/Firefox.app/Contents/MacOS/firefox'):undefined);
const options=new firefox.Options().addArguments('-headless');if(binary)options.setBinary(binary);
options.setPreference('extensions.webextensions.warnings-as-errors',false);
let driver;
try{
 execFileSync('python3',['-c',`from pathlib import Path\nimport zipfile\nr=Path('apps/firefox/dist')\nwith zipfile.ZipFile('artifacts/firefox-test.zip','w',zipfile.ZIP_DEFLATED) as z:\n for p in r.rglob('*'):\n  if p.is_file(): z.write(p,p.relative_to(r))`]);
 driver=await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(new firefox.ServiceBuilder().addArguments('--allow-system-access')).build();
 await driver.manage().window().setRect({width:1440,height:1050});
 await driver.manage().setTimeouts({script:30000,pageLoad:30000});
 const version=(await driver.getCapabilities()).get('browserVersion');
 const addon=await driver.installAddon(resolve('artifacts/firefox-test.zip'),true);console.log('Installed',addon,'on Firefox',version);
 let origin,extensionHandle;
 await driver.wait(async()=>{
  for(const h of await driver.getAllWindowHandles()) {await driver.switchTo().window(h);const url=await driver.getCurrentUrl();if(url.startsWith('moz-extension://')){origin=url.match(/^moz-extension:\/\/[^/]+/)[0];extensionHandle=h;return true;}}
  return false;
 },20000,'onboarding did not open');
 await driver.switchTo().window(extensionHandle);
 await driver.executeScript("location.href=arguments[0]",origin+'/options.html');
 await driver.wait(until.elementLocated(By.id('provider')),10000);
 const initial=await driver.executeAsyncScript(`const done=arguments[arguments.length-1]; Promise.all([browser.permissions.contains({permissions:['userScripts']}),browser.storage.local.get('xgoose.settings')]).then(([permission,data])=>done({permission,settings:data['xgoose.settings']}));`);
 assert.equal(initial.permission,false);
 await driver.executeAsyncScript(`const done=arguments[arguments.length-1];browser.storage.local.set({'xgoose.settings':{provider:'openai-compat',apiKeys:{'openai-compat':'synthetic-test'},baseUrls:{'openai-compat':arguments[0]},model:'fixture',analyticsEnabled:false,launcherVisibility:'always',language:'en'}}).then(()=>done(true),e=>done({error:e.message}));`,base);
 const skills=await driver.executeAsyncScript(`const done=arguments[arguments.length-1];browser.runtime.sendMessage({kind:'sw:list_skills'}).then(done,e=>done({error:e.message}));`);assert.equal(skills.length,34);
 await writeFile('artifacts/firefox-e2e/options.png',await driver.takeScreenshot(),'base64');
 await driver.executeScript("location.href=arguments[0]",origin+'/onboarding.html');
 await driver.wait(until.elementLocated(By.id('connectionState')),10000);
 await driver.wait(async()=>driver.findElement(By.id('connectionState')).getText().then(t=>t.includes('Your own provider is configured')),10000);
 assert.equal(await driver.findElement(By.id('permissionStep')).getAttribute('open'),null);
 await writeFile('artifacts/firefox-e2e/onboarding.png',await driver.takeScreenshot(),'base64');
 await driver.manage().window().setRect({width:390,height:844});
 await driver.executeAsyncScript(`const done=arguments[arguments.length-1];browser.storage.local.get('xgoose.settings').then(d=>browser.storage.local.set({'xgoose.settings':{...d['xgoose.settings'],language:'zh-CN'}})).then(()=>done(true));`);
 await driver.wait(async()=>driver.findElement(By.id('accountStepTitle')).getText().then(t=>t==='连接你的 AI'),10000);
 assert.equal(await driver.executeScript('return document.documentElement.scrollWidth<=innerWidth'),true,'mobile onboarding overflows');
 await writeFile('artifacts/firefox-e2e/onboarding-zh-mobile.png',await driver.takeScreenshot(),'base64');
 await driver.manage().window().setRect({width:1440,height:1050});
 await driver.executeAsyncScript(`const done=arguments[arguments.length-1];browser.storage.local.get('xgoose.settings').then(d=>browser.storage.local.set({'xgoose.settings':{...d['xgoose.settings'],language:'en'}})).then(()=>done(true));`);
 console.log('onboarding: account-free BYOK, optional scripts, Chinese and mobile layout passed');
 await driver.switchTo().newWindow('tab');
 await driver.get(base+'/article');
 await driver.wait(async()=>driver.executeScript(`return !!document.querySelector('#xgoose-root')?.shadowRoot?.querySelector('.toggle')`),20000,'content script did not mount');
 const shadow=await driver.findElement(By.id('xgoose-root')).getShadowRoot();
 await (await shadow.findElement(By.css('.toggle'))).click();
 await driver.wait(async()=>driver.executeScript("return !!document.querySelector('#xgoose-root').shadowRoot.querySelector('.panel.open')"),10000,'panel did not open');
 await (await shadow.findElement(By.css('.in-text'))).sendKeys('Read this page and summarize how xgoose works.');
 await (await shadow.findElement(By.css('.btn-send'))).click();
 await driver.wait(async()=>{
  const state=await driver.executeScript(`const r=document.querySelector('#xgoose-root')?.shadowRoot;return {done:r?.textContent.includes('Firefox research complete.'),error:r?.querySelector('.msg-err')?.textContent};`);
  if(state.error)throw new Error('Firefox conversation failed: '+state.error);
  return state.done;
 },60000,'AI streaming did not complete');
 console.log('page reading and streamed answer passed');
 assert.equal(requests.length,2);assert.ok(requests[1].messages.some(m=>m.role==='tool'&&JSON.stringify(m).includes('Research the web')),'read_page did not return page content');
 await writeFile('artifacts/firefox-e2e/research.png',await driver.takeScreenshot(),'base64');
 // Built-in page-world injection and structured invocation need no optional userScripts permission.
 await driver.switchTo().window(extensionHandle);
 await driver.executeScript("location.href=arguments[0]",origin+'/options.html');
 await driver.switchTo().newWindow('tab');
 await driver.get('https://news.ycombinator.com/');
 await driver.wait(async()=>driver.executeScript(`return typeof window.xgoose?.skills?.hn?.frontPage==='function'||!!window.xgoose?.skills?.hn`),30000,'built-in HN skill did not load');
 const snapshot=await driver.executeScript('return Object.keys(window.xgoose.skills.hn)');assert.ok(snapshot.length>5);
 await driver.switchTo().window(extensionHandle);
 await driver.executeScript("location.href=arguments[0]",origin+'/options.html');
 await driver.wait(until.elementLocated(By.id('provider')),10000);
 const builtin=await driver.executeAsyncScript(`const done=arguments[arguments.length-1];(async()=>{const [t]=await browser.tabs.query({url:'https://news.ycombinator.com/*'});const r=await browser.scripting.executeScript({target:{tabId:t.id},func:()=>browser.runtime.sendMessage({kind:'sw:skill_invoke',payload:{namespace:'hn',functionName:'getRateLimit',args:{},timeoutMs:5000}})});done(r[0].result)})().catch(e=>done({error:String(e)}));`);
 assert.equal(builtin.ok,true,JSON.stringify(builtin));console.log('built-in structured skill call passed without optional permission');
 await driver.switchTo().window(extensionHandle);
 await driver.executeScript("location.href=arguments[0]",origin+'/onboarding.html');
 await driver.wait(until.elementLocated(By.id('openExtensions')),10000);
 await driver.wait(async()=>driver.executeScript(`return document.getElementById('permissionState')?.textContent.includes('Built-in skills are ready')`),10000,'onboarding script did not initialize');
 await driver.findElement(By.id('permissionStepSummary')).click();
 await driver.findElement(By.id('openExtensions')).click();
 // Approve the prompt in this isolated automation profile only.
 await driver.setContext(firefox.Context.CHROME);

 await driver.wait(async()=>driver.executeScript(`return !!document.getElementById('addon-webext-permissions-notification')?.querySelector('moz-checkbox')?.shadowRoot?.querySelector('input[type="checkbox"]')`),10000,'User Scripts prompt checkbox did not render').catch(async error=>{console.error('Permission prompt DOM',await driver.executeScript(`return {notification:document.getElementById('addon-webext-permissions-notification')?.outerHTML,panel:document.getElementById('notification-popup')?.outerHTML?.slice(-12000)}`));throw error;});
 const prompt=await driver.executeScript(`const n=document.getElementById('addon-webext-permissions-notification');const checkbox=n.querySelector('moz-checkbox');return {text:n.textContent,hasScriptCheckbox:!!checkbox};`);assert.equal(prompt.hasScriptCheckbox,true);
 await driver.executeScript(`const c=document.getElementById('addon-webext-permissions-notification').querySelector('moz-checkbox');c.shadowRoot.querySelector('input[type="checkbox"]').click();`);
 await driver.wait(async()=>driver.executeScript(`return !document.getElementById('addon-webext-permissions-notification')?.button?.disabled`),10000,'permission button remained disabled');
 await driver.executeScript(`const n=document.getElementById('addon-webext-permissions-notification');n.button.click();`);
 await driver.setContext(firefox.Context.CONTENT);
 await driver.wait(async()=>driver.executeAsyncScript(`const done=arguments[arguments.length-1];browser.permissions.contains({permissions:['userScripts']}).then(done);`),10000,'optional permission not granted');
 await driver.switchTo().window(extensionHandle);
 await driver.executeScript("location.href=arguments[0]",origin+'/options.html');
 await driver.wait(until.elementLocated(By.id('provider')),10000);
 const custom=await driver.executeAsyncScript(`const done=arguments[arguments.length-1];(async()=>{
  const t=await browser.tabs.create({url:arguments[0]});
  await new Promise(r=>setTimeout(r,1500));
  const results=await browser.scripting.executeScript({target:{tabId:t.id},func:()=>browser.runtime.sendMessage({kind:'sw:page_exec',payload:{code:'return {answer:6*7,title:document.title};',execId:'firefox-test',timeoutMs:5000}})});
  done(results[0].result);
 })().catch(e=>done({error:String(e)}));`,base+'/article');
 assert.equal(custom.ok,true,JSON.stringify(custom));assert.equal(custom.result.answer,42);console.log('custom script execution passed');
 // Use the actual Firefox content realm and background transport for context regression.
 const contextResults=[];
 const longPrompt='evidence '.repeat(150000)+'FINAL_GOAL';
 for(const scenario of [{name:'large',model:'luna',prompt:longPrompt,window:'1,050,000',compact:false},{name:'small',model:'gpt-4o-mini',prompt:longPrompt,window:'128,000',compact:true},{name:'recovery',model:'luna',prompt:'evidence '.repeat(40000)+' Force a context rejection and preserve FINAL_GOAL.',window:'1,050,000',compact:true,reject:true}]){
  contextFixture={...scenario,normal:0,summaries:0};
  await driver.switchTo().window(extensionHandle);
  await driver.executeAsyncScript(`const done=arguments[arguments.length-1];browser.storage.local.get('xgoose.settings').then(d=>browser.storage.local.set({'xgoose.settings':{...d['xgoose.settings'],model:arguments[0]}})).then(()=>done(true));`,scenario.model);
  await driver.switchTo().newWindow('tab');await driver.get(base+'/article?context='+scenario.name);
  await driver.wait(async()=>driver.executeScript(`return !!document.querySelector('#xgoose-root')?.shadowRoot?.querySelector('.toggle')`),20000);
  const root=await driver.findElement(By.id('xgoose-root')).getShadowRoot();
  if(!await driver.executeScript(`return !!document.querySelector('#xgoose-root').shadowRoot.querySelector('.panel.open')`))await (await root.findElement(By.css('.toggle'))).click();
  await (await root.findElement(By.css('.btn-new'))).click();
  await driver.executeScript(`const el=document.querySelector('#xgoose-root').shadowRoot.querySelector('.in-text');el.value=arguments[0];el.dispatchEvent(new Event('input',{bubbles:true}));`,scenario.prompt);
  await (await root.findElement(By.css('.btn-send'))).click();
  await driver.wait(async()=>{
   const state=await driver.executeScript(`const r=document.querySelector('#xgoose-root')?.shadowRoot;return {done:r?.textContent.includes(arguments[0]),error:r?.querySelector('.msg-err')?.textContent};`,`Context fixture ${scenario.name} completed.`);
   if(state.error)throw new Error('Context fixture failed: '+state.error);return state.done;
  },120000,'Context scenario did not complete: '+scenario.name);
  await driver.wait(async()=>!(await (await root.findElement(By.css('.btn-stop'))).isDisplayed()),20000);
  const title=await (await root.findElement(By.css('.context-meter'))).getAttribute('title');
  assert.ok(title.includes(scenario.window+' tokens'),title);assert.ok(!title.includes('UTF-8 bytes'),title);
  assert.equal(contextFixture.normal,scenario.reject?2:1);
  assert.equal(contextFixture.summaries>0,scenario.compact);
  if(!scenario.compact)assert.ok(JSON.stringify(contextFixture.sent).includes(longPrompt),'large context was truncated');
  contextResults.push({name:scenario.name,model:scenario.model,normalRequests:contextFixture.normal,summaryRequests:contextFixture.summaries});
  await writeFile(`artifacts/firefox-e2e/context-${scenario.name}.png`,await driver.takeScreenshot(),'base64');
  await driver.close();await driver.switchTo().window(extensionHandle);
 }
 contextFixture=null;console.log('Firefox context windows and automatic recovery passed',JSON.stringify(contextResults));
 const report={passed:true,browserVersion:version,builtInSkills:skills.length,providerRequests:requests.length,contextResults,largeModelInputAbove128K:true,smallModelCompaction:true,contextRejectionRetry:true,readPage:true,streaming:true,builtinWithoutOptionalPermission:true,userScriptsPermission:true,customExecution:true};
 await writeFile('artifacts/firefox-e2e/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(driver){try{await driver.setContext(firefox.Context.CONTENT);await writeFile('artifacts/firefox-e2e/failure.png',await driver.takeScreenshot(),'base64');console.error(await driver.executeScript("return (document.querySelector('#xgoose-root')?.shadowRoot?.querySelector('.msgs')?.textContent||document.body.innerText).slice(-1500)"));console.error('provider requests',requests.length);}catch{}}throw error;}
finally{if(driver)await driver.quit();server.close();}
