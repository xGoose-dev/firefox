import {Builder,By,until} from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><style>body{font:19px Georgia}</style><h1>Firefox appearance fixture</h1>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const artifacts=resolve('artifacts/appearance');await mkdir(artifacts,{recursive:true});
execFileSync('python3',['-c',`from pathlib import Path\nimport zipfile\nr=Path('apps/firefox/dist')\nwith zipfile.ZipFile('artifacts/appearance/firefox.zip','w',zipfile.ZIP_DEFLATED) as z:\n for p in r.rglob('*'):\n  if p.is_file():z.write(p,p.relative_to(r))`]);
const options=new firefox.Options().addArguments('-headless');if(process.env.FIREFOX_BINARY)options.setBinary(process.env.FIREFOX_BINARY);
let driver;
try{
 driver=await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(new firefox.ServiceBuilder().addArguments('--allow-system-access')).build();await driver.manage().setTimeouts({script:20000,pageLoad:30000});await driver.manage().window().setRect({width:1280,height:1000});await driver.installAddon(resolve(artifacts,'firefox.zip'),true);
 let origin,settingsHandle;
 await driver.wait(async()=>{for(const h of await driver.getAllWindowHandles()){await driver.switchTo().window(h);const u=await driver.getCurrentUrl();if(u.startsWith('moz-extension://')){origin=u.match(/^moz-extension:\/\/[^/]+/)[0];settingsHandle=h;return true;}}return false;},20000);
 await driver.get(origin+'/options.html#appearance');await driver.wait(until.elementLocated(By.css('[data-preset=notebook]')),15000);
 await driver.executeAsyncScript(`const done=arguments[arguments.length-1];browser.storage.local.set({'xgoose.settings':{theme:'system',analyticsEnabled:false,launcherVisibility:'always',language:'en'}}).then(()=>done(true));`);
 const click=async selector=>{const el=await driver.findElement(By.css(selector));await driver.executeScript('arguments[0].scrollIntoView({block:"center"})',el);await el.click();};
 await click('[data-preset=notebook]');await driver.executeScript(`const el=document.querySelector('[data-field=font]');el.value='serif';el.dispatchEvent(new Event('change'));`);await click('[data-scale="1.3"]');await driver.wait(async()=>await driver.findElement(By.css('.xg-save-status')).getText()==='Saved',10000);
 const get=()=>driver.executeAsyncScript(`const done=arguments[arguments.length-1];browser.storage.local.get('xgoose.settings').then(r=>done(r['xgoose.settings']));`);let saved=await get();assert.deepEqual(saved.appearance,{preset:'notebook',font:'serif',fontScale:1.3});
 await driver.navigate().refresh();await driver.wait(until.elementLocated(By.css('[data-preset=notebook][aria-pressed=true]')),15000);
 await driver.switchTo().newWindow('tab');await driver.get(`http://127.0.0.1:${server.address().port}/`);await driver.wait(async()=>driver.executeScript('return !!document.querySelector("#xgoose-root")?.shadowRoot?.querySelector(".panel")'),15000);assert.equal(await driver.executeScript('return document.querySelector("#xgoose-root").shadowRoot.querySelector(".panel").style.getPropertyValue("--xg-font-scale")'),'1.3');assert.equal(await driver.executeScript('return getComputedStyle(document.body).fontSize'),'19px');await writeFile(resolve(artifacts,'firefox-panel.png'),await driver.takeScreenshot(),'base64');
 await driver.switchTo().window(settingsHandle);await driver.manage().window().setRect({width:430,height:900});await driver.executeScript('document.querySelector("#appearance").scrollIntoView()');await writeFile(resolve(artifacts,'firefox-settings.png'),await driver.takeScreenshot(),'base64');
 await click('[data-action=reset]');await driver.wait(async()=>await driver.findElement(By.css('.xg-save-status')).getText()==='Saved',10000);saved=await get();assert.deepEqual(saved.appearance,{preset:'default',font:'default',fontScale:1});assert.equal(saved.analyticsEnabled,false);
 console.log(JSON.stringify({passed:true,firefox:(await driver.getCapabilities()).get('browserVersion'),autoSave:true,refresh:true,shadowPanel:true,hostPageUntouched:true,resetPreservesConsent:true}));
}finally{await driver?.quit();server.close();}
