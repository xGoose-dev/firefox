import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadableStream as PolyReadableStream} from 'web-streams-polyfill';
import {makeStreamingResponse} from '../apps/firefox/src/content/hostPorts/streamingResponse.ts';
import {normalizeHostedError} from '../apps/firefox/src/shared/hosted.ts';

function stream(text:string) {
 const bytes=new TextEncoder().encode(text);
 // Deliberately split multi-byte characters across chunks in a non-native stream.
 return new PolyReadableStream({start(controller){
  for(let i=0;i<bytes.length;i+=2)controller.enqueue(bytes.slice(i,i+2));
  controller.close();
 }}) as unknown as ReadableStream<Uint8Array>;
}
test('Firefox streamed HTTP errors expose the full JSON body once',async()=>{
 const response=makeStreamingResponse(400,{'x-xgoose-context-target-tokens':'32000'},stream(JSON.stringify({error:{code:'context_length_exceeded',message:'上下文超限'}})));
 assert.equal(response.ok,false);assert.equal(response.bodyUsed,false);
 assert.equal(response.headers.get('x-xgoose-context-target-tokens'),'32000');
 assert.deepEqual(await response.json(),{error:{code:'context_length_exceeded',message:'上下文超限'}});
 assert.equal(response.bodyUsed,true);await assert.rejects(response.text(),/already used/);
});
test('Hosted normalization preserves context errors and retry metadata from Firefox streams',async()=>{
 const response=await normalizeHostedError(makeStreamingResponse(400,{'x-xgoose-context-target-tokens':'32000'},stream(JSON.stringify({error:{code:'context_length_exceeded',message:'Model context limit exceeded'}}))));
 assert.equal(response.status,400);assert.equal(response.headers.get('x-xgoose-context-target-tokens'),'32000');
 assert.equal((await response.json()).error.code,'context_length_exceeded');
});
test('successful Firefox SSE stays available to incremental readers',async()=>{
 const response=makeStreamingResponse(200,{'content-type':'text/event-stream'},stream('data: hello\n\n'));
 const reader=response.body!.getReader();const first=await reader.read();
 assert.equal(new TextDecoder().decode(first.value),'da');assert.equal(first.done,false);
 await assert.rejects(response.text(),/already used/);await reader.cancel();
});
test('Firefox error body read failures propagate instead of becoming empty context errors',async()=>{
 const response=makeStreamingResponse(400,{},new PolyReadableStream({start(controller){controller.error(new Error('transport disconnected'));}}) as unknown as ReadableStream<Uint8Array>);
 await assert.rejects(response.text(),/transport disconnected/);
});
