import {By} from 'selenium-webdriver';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

// Run the built Firefox extension in its real content and event-page realms.
// Only external I/O is replaced; production deadlines and queue code stay intact.
export async function reviewRecovery(driver,{extensionHandle,base}) {
 const handles=[];
 const background=async(code,...args)=>{
  await driver.switchTo().window(extensionHandle);
  const result=await driver.executeAsyncScript(`const done=arguments[arguments.length-1];(async()=>{const bg=await browser.runtime.getBackgroundPage();${code}})().then(done,e=>done({fixtureError:String(e)}));`,...args);
  assert.ok(!result?.fixtureError,JSON.stringify(result));return result;
 };
 await background(`
  const saved=await browser.storage.local.get('xgoose.settings');
  const original=bg.fetch,send=bg.browser.tabs.sendMessage.bind(bg.browser.tabs);
  bg.reviewRecovery={requests:0,freeze:true,hold:false,pending:[],saved:saved['xgoose.settings'],original,send};
  bg.browser.tabs.sendMessage=(tabId,message,...args)=>bg.reviewRecovery.freeze&&message.kind==='cs:peer_identity'?new Promise(()=>{}):send(tabId,message,...args);
  bg.fetch=async(input,init)=>{
   const req=new bg.Request(input,init),url=new URL(req.url),f=bg.reviewRecovery;
   if(url.hostname==='firefox-recovery.fixture.test'){
    const index=++f.requests,frame=(delta,finish=null)=>'data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})+'\\n\\n';
    const reply=()=>new bg.Response(frame({content:'FIREFOX_RECOVERED_'+index})+frame({},'stop')+'data: [DONE]\\n\\n',{headers:{'content-type':'text/event-stream'}});
    if(!f.hold)return reply();
    return new Promise((resolve,reject)=>{req.signal.addEventListener('abort',()=>reject(new bg.DOMException('Stopped','AbortError')),{once:true});f.pending.push(()=>resolve(reply()));});
   }
   if(url.hostname==='api.xgoose.org')return new bg.Response(JSON.stringify({items:[],data:[],acknowledged:[]}),{headers:{'content-type':'application/json'}});
   return original(input,init);
  };
  await browser.storage.local.set({'xgoose.settings':{provider:'openai-compat',model:'fixture',language:'en',thinking:false,analyticsEnabled:false,launcherVisibility:'always',apiKeys:{'openai-compat':'fixture-key'},baseUrls:{'openai-compat':'https://firefox-recovery.fixture.test/v1'}}});return true;
 `);
 try {
  const open=async(path)=>{
   await driver.switchTo().newWindow('tab');const handle=await driver.getWindowHandle();handles.push(handle);
   await driver.get(base+'/article?review='+path);
   await driver.wait(()=>driver.executeScript("return !!document.querySelector('#xgoose-root')?.shadowRoot?.querySelector('.toggle')"),20000);
   const root=await driver.findElement(By.id('xgoose-root')).getShadowRoot();
   if(!await driver.executeScript("return !!document.querySelector('#xgoose-root').shadowRoot.querySelector('.panel.open')"))await (await root.findElement(By.css('.toggle'))).click();
   await driver.wait(()=>driver.executeScript("return !!document.querySelector('#xgoose-root').shadowRoot.querySelector('.panel.open')"),10000,'recovery panel did not open');
   await driver.wait(async()=>(await root.findElement(By.css('.in-text'))).isDisplayed(),10000);
   return {handle,root};
  };
  const page=await open('first');
  const use=()=>driver.switchTo().window(page.handle);
  const text=()=>driver.executeScript("return document.querySelector('#xgoose-root').shadowRoot.querySelector('.msgs').textContent");
  const send=async(value)=>{await use();await (await page.root.findElement(By.css('.in-text'))).sendKeys(value);await (await page.root.findElement(By.css('.btn-send'))).click();};
  const idle=async()=>{await use();await driver.wait(async()=>!(await (await page.root.findElement(By.css('.btn-stop'))).isDisplayed()),40000);};
  const answer=async(n)=>{await use();await driver.wait(async()=>(await text()).includes('FIREFOX_RECOVERED_'+n),40000);};
  const count=()=>background('return bg.reviewRecovery.requests;');
  await send('First question while peer registration is unresponsive');
  await driver.wait(async()=>(await text()).includes('First question'),5000,'submitted message did not appear while registration was pending');
  await driver.wait(async()=>(await text()).includes('did not respond'),20000);await idle();assert.equal(await count(),0);
  await background('bg.reviewRecovery.freeze=false;return true;');
  await send('Retry after the peer is reachable');await answer(1);await idle();
  const fault=async(mode)=>background(`
   const tab=(await browser.tabs.query({})).find(t=>t.url===arguments[0]);
   await browser.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:(mode)=>{
    const original=browser.runtime.sendMessage.bind(browser.runtime);
    browser.runtime.sendMessage=(message,...args)=>{
     const match=mode==='save'?message.kind==='sw:session'&&message.payload.op==='save':message.kind==='sw:transcript_event'&&message.payload.event.type==='run-end';
     if(match){browser.runtime.sendMessage=original;return new Promise(()=>{});}return original(message,...args);
    };
   },args:[arguments[1]]});return true;
  `,base+'/article?review=first',mode);
  await use();await (await page.root.findElement(By.css('.btn-new'))).click();
  await fault('save');await send('Question whose initial save never responds');
  await driver.wait(async()=>(await text()).includes('initial save'),5000,'submitted message did not appear while storage was pending');
  await driver.wait(async()=>(await text()).includes('Extension request timed out (sw:session)'),40000);await idle();assert.equal(await count(),1);
  await send('Retry after the storage timeout');await answer(2);await idle();
  await fault('finish');await send('Complete even when final bookkeeping stops responding');await answer(3);
  await send('Queued follow-up must drain after the cleanup deadline');
  await driver.wait(async()=>(await page.root.findElements(By.css('.queued-pill'))).length===1,5000);
  await answer(4);await idle();assert.equal((await page.root.findElements(By.css('.queued-pill'))).length,0);assert.equal(await count(),4);
  const second=await open('second');await (await second.root.findElement(By.css('.in-text'))).sendKeys('A second page should still work');await (await second.root.findElement(By.css('.btn-send'))).click();
  await driver.wait(()=>driver.executeScript("return document.querySelector('#xgoose-root').shadowRoot.textContent.includes('FIREFOX_RECOVERED_5')"),30000);
  assert.equal(await count(),5);

  // Stop/New must discard C even after B has started draining the shared queue.
  for(const action of ['stop','new']) {
   const before=await count();await background('bg.reviewRecovery.hold=true;return true;');
   await send(action+' A');await driver.wait(async()=>(await count())===before+1,15000);
   await send(action+' B');await send(action+' C');
   await background('bg.reviewRecovery.pending.shift()();return true;');await driver.wait(async()=>(await count())===before+2,15000);
   await use();await (await page.root.findElement(By.css(action==='stop'?'.btn-stop':'.btn-new'))).click();await idle();
   await background('bg.reviewRecovery.hold=false;return true;');
   await send(action+' D');await answer(before+3);await idle();assert.equal(await count(),before+3,'cancelled queued prompt was replayed');
   await background('bg.reviewRecovery.pending=[];return true;');
  }
  await use();await writeFile('artifacts/firefox-e2e/review-recovery.png',await driver.takeScreenshot(),'base64');
  const result={peerTimeout:true,initialSaveTimeout:true,cleanupTimeout:true,queuedFollowup:true,secondPage:true,stopDiscardsQueue:true,newDiscardsQueue:true,providerRequests:await count(),modelRequestsReplayed:0,syntheticOnly:true};
  await writeFile('artifacts/firefox-e2e/review-recovery.json',JSON.stringify(result,null,2));console.log('Firefox review recovery',JSON.stringify(result));return result;
 } catch(error) {
  await driver.switchTo().window(handles[0]);
  console.error('Recovery page state',await driver.executeScript("return document.querySelector('#xgoose-root')?.shadowRoot?.textContent"));
  await writeFile('artifacts/firefox-e2e/review-recovery-failure.png',await driver.takeScreenshot(),'base64');
  throw error;
 } finally {
  await background('const f=bg.reviewRecovery;bg.fetch=f.original;bg.browser.tabs.sendMessage=f.send;await browser.storage.local.set({"xgoose.settings":f.saved});delete bg.reviewRecovery;return true;');
  for(const handle of handles){await driver.switchTo().window(handle);await driver.close();}
  await driver.switchTo().window(extensionHandle);
 }
}
