import assert from 'node:assert/strict';

export async function networkCompatibility(driver,{base,extensionHandle}){
 await driver.switchTo().newWindow('tab');
 try{
  await driver.get(base+'/article?network-compatibility');
  await driver.wait(()=>driver.executeScript('return !!window.__xgoose'),20000);
  const result=await driver.executeAsyncScript(`const done=arguments[arguments.length-1];
   const Constructor=XMLHttpRequest;
   Object.defineProperty(Constructor.prototype,'open',{writable:false,configurable:true});
   Object.freeze(Constructor.prototype);
   const xhr=new Constructor();Object.preventExtensions(xhr);
   xhr.onreadystatechange=()=>{if(xhr.readyState===1){xhr.setRequestHeader('X-Fixture','opened');xhr.send();}};
   xhr.onloadend=()=>{
    const entries=window.__xgoose.getNetworkRequests({filter:'network-echo'});
    const entry=entries[0];
    done({status:xhr.status,nativeConstructor:Constructor.prototype.constructor===Constructor,constant:Constructor.DONE,
     captured:entries.length,headers:entry&&window.__xgoose.getNetworkRequestDetail(entry.id,'headers').req});
   };
   try{xhr.open('GET',new URL(arguments[0]+'/article?network-echo'));}
   catch(error){done({error:String(error)});}`,base);
  assert.equal(result.error,undefined,JSON.stringify(result));
  assert.equal(result.status,200);assert.equal(result.nativeConstructor,true);assert.equal(result.constant,4);
  assert.equal(result.captured,1);assert.equal(result.headers['x-fixture'],'opened');
  console.log('Firefox readonly networking compatibility passed',JSON.stringify(result));
  return result;
 }finally{await driver.close();await driver.switchTo().window(extensionHandle);}
}
