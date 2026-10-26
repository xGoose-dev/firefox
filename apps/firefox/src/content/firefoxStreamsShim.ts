// Firefox content-script shim for the WHATWG Streams classes.
//
// The bug
// ───────
//
// Inside a Firefox extension content script, the Streams constructors
// (`ReadableStream`, `WritableStream`, `TransformStream`,
// `TextDecoderStream`) are Xrays into the page realm. When you call
// them, Firefox switches into the page realm to run the constructor.
// That constructor then reads optional callbacks (`start`, `pull`,
// `cancel`, `transform`, `flush`, …) off the underlying source /
// sink / transformer you passed in. The transformer lives in the
// sandbox realm, so the cross-compartment wrapper denies the lookup:
//
//     Error: Permission denied to access property "flush"
//
// See https://bugzilla.mozilla.org/show_bug.cgi?id=1757836 (this is
// the Mozilla-tracked instance for ReadableStream; the same root
// cause affects TransformStream + WritableStream + TextDecoderStream).
//
// We tried two milder workarounds first:
//
//   1. Stamping the optional callback names onto the transformer as
//      own data properties so the property lookup succeeds — Firefox
//      still denied access (the Xray ACL ignores own-property
//      stamping for these names).
//
//   2. Calling `window.wrappedJSObject.TransformStream` with the
//      transformer `cloneInto`'d into the page realm — this fixed
//      `flush` but immediately tripped a follow-on
//      `Permission denied to access property "then"` from the
//      page-realm pipe runner awaiting the (sandbox-realm) Promise
//      returned by the async `transform` callback.
//
// The fully working fix is to skip the WebIDL streams machinery
// entirely and use `web-streams-polyfill` — a pure-JS WHATWG-spec
// implementation. Both the streams and the transformer callbacks live
// in the sandbox realm, so no Xray boundary is crossed, no Promise
// crosses a realm, and the AI SDK's streaming-LLM pipeline runs
// exactly like it does on Chrome and Safari.
//
// One caveat: `new Response(polyfilledStream, …)` is WebIDL and
// doesn't accept a polyfilled `ReadableStream`. The streaming path
// in `src/content/hostPorts/fetcherPort.ts` returns a duck-typed
// Response-like object (`status`, `ok`, `headers`, `body`, `text`,
// `json`, …) instead. The AI SDK only consumes `response.body`,
// `response.status`, `response.headers`, `response.ok`, so this is
// invisible to it.

import {
  ReadableStream as PonyReadableStream,
  WritableStream as PonyWritableStream,
  TransformStream as PonyTransformStream,
} from "web-streams-polyfill";

const PATCH_FLAG = "__xgoose_firefox_streams_patched__";

type FlaggedGlobal = typeof globalThis & {
  [PATCH_FLAG]?: boolean;
  TextDecoderStream: typeof TextDecoderStream;
  TransformStream: typeof TransformStream;
  ReadableStream: typeof ReadableStream;
  WritableStream: typeof WritableStream;
  Headers: typeof Headers;
};

// Minimal pure-JS `Headers` implementation. Native `new Headers(…)`
// in a Firefox content script suffers the same Xray-into-page-realm
// story as the Stream constructors — and the resulting object's
// `.entries()` iterator can't be consumed across realms by
// `Object.fromEntries`, which the AI SDK relies on in
// `with-user-agent-suffix.ts`:
//
//     Error: normalizedHeaders.entries() is not iterable
//
// A sandbox-realm `Headers` keeps every iterator inside the same
// realm as the callers.
class SandboxHeaders {
  private readonly _map = new Map<string, string>();

  constructor(init?: HeadersInit | Record<string, string | undefined>) {
    if (init == null) return;
    if (init instanceof SandboxHeaders) {
      init.forEach((v, k) => this.append(k, v));
      return;
    }
    if (Array.isArray(init)) {
      for (const entry of init as Array<[string, string]>) {
        if (!entry || entry.length !== 2) continue;
        this.append(String(entry[0]), String(entry[1]));
      }
      return;
    }
    // Native `Headers` instance (e.g. from a WebIDL Request/Response).
    // `forEach` works across the Xray; `.entries()` is the part that
    // doesn't.
    if (typeof (init as Headers).forEach === "function") {
      (init as Headers).forEach((value, key) => this.append(key, value));
      return;
    }
    for (const [k, v] of Object.entries(init as Record<string, unknown>)) {
      if (v == null) continue;
      this.append(k, String(v));
    }
  }

  append(name: string, value: string): void {
    const k = name.toLowerCase();
    const existing = this._map.get(k);
    this._map.set(k, existing == null ? String(value) : `${existing}, ${value}`);
  }

  set(name: string, value: string): void {
    this._map.set(name.toLowerCase(), String(value));
  }

  delete(name: string): void {
    this._map.delete(name.toLowerCase());
  }

  get(name: string): string | null {
    const v = this._map.get(name.toLowerCase());
    return v == null ? null : v;
  }

  has(name: string): boolean {
    return this._map.has(name.toLowerCase());
  }

  forEach(
    cb: (value: string, key: string, parent: SandboxHeaders) => void,
    thisArg?: unknown,
  ): void {
    for (const [k, v] of this._map.entries()) {
      cb.call(thisArg, v, k, this);
    }
  }

  *entries(): IterableIterator<[string, string]> {
    for (const [k, v] of this._map.entries()) yield [k, v];
  }

  *keys(): IterableIterator<string> {
    for (const k of this._map.keys()) yield k;
  }

  *values(): IterableIterator<string> {
    for (const v of this._map.values()) yield v;
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }
}

// Pure-JS `TextDecoderStream` built from `new TextDecoder()` (works
// fine in content scripts; no streams involved in the decoder) and
// the polyfill's `TransformStream`. The combined object is fully
// sandbox-realm and pipes seamlessly with the other polyfilled
// streams.
class SandboxTextDecoderStream extends PonyTransformStream<
  BufferSource,
  string
> {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;

  constructor(label = "utf-8", options: TextDecoderOptions = {}) {
    const decoder = new TextDecoder(label, options);
    super({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });
        if (text) controller.enqueue(text);
      },
      flush(controller) {
        const text = decoder.decode();
        if (text) controller.enqueue(text);
      },
    });
    this.encoding = decoder.encoding;
    this.fatal = decoder.fatal;
    this.ignoreBOM = decoder.ignoreBOM;
  }
}

// Native URLSearchParams iterators cross Firefox's Xray realm boundary too.
// Keep the native URL parser and live parameter storage; expose JS iterators.
const NativeURL=URL;
const NativeURLSearchParams=URLSearchParams;
class SandboxURLSearchParams implements URLSearchParams {
  private native: URLSearchParams;
  constructor(init?: string | string[][] | Record<string,string> | URLSearchParams, native?: URLSearchParams) {
    this.native=native??new NativeURLSearchParams(init instanceof SandboxURLSearchParams?init.toString():init);
  }
  get size(){return this.native.size;}
  append(name:string,value:string){this.native.append(name,value);}
  delete(name:string,value?:string){this.native.delete(name,value);}
  get(name:string){return this.native.get(name);}
  getAll(name:string){const result:string[]=[];this.native.forEach((value,key)=>{if(key===name)result.push(value);});return result;}
  has(name:string,value?:string){return this.native.has(name,value);}
  set(name:string,value:string){this.native.set(name,value);}
  sort(){this.native.sort();}
  toString(){return this.native.toString();}
  forEach(callback:(value:string,key:string,parent:URLSearchParams)=>void,thisArg?:any){this.native.forEach((value,key)=>callback.call(thisArg,value,key,this));}
  *entries():URLSearchParamsIterator<[string,string]>{const rows:[string,string][]=[];this.native.forEach((v,k)=>rows.push([k,v]));yield* rows;}
  *keys():URLSearchParamsIterator<string>{for(const [k] of this.entries())yield k;}
  *values():URLSearchParamsIterator<string>{for(const [,v] of this.entries())yield v;}
  [Symbol.iterator](){return this.entries();}
}
class SandboxURL implements URL {
  private native:URL;
  constructor(value:string|URL,base?:string|URL){this.native=new NativeURL(String(value),base===undefined?undefined:String(base));}
  get href(){return this.native.href;} set href(v:string){this.native.href=v;}
  get origin(){return this.native.origin;}
  get protocol(){return this.native.protocol;} set protocol(v:string){this.native.protocol=v;}
  get username(){return this.native.username;} set username(v:string){this.native.username=v;}
  get password(){return this.native.password;} set password(v:string){this.native.password=v;}
  get host(){return this.native.host;} set host(v:string){this.native.host=v;}
  get hostname(){return this.native.hostname;} set hostname(v:string){this.native.hostname=v;}
  get port(){return this.native.port;} set port(v:string){this.native.port=v;}
  get pathname(){return this.native.pathname;} set pathname(v:string){this.native.pathname=v;}
  get search(){return this.native.search;} set search(v:string){this.native.search=v;}
  get hash(){return this.native.hash;} set hash(v:string){this.native.hash=v;}
  get searchParams():URLSearchParams{return new SandboxURLSearchParams(undefined,this.native.searchParams);}
  toString(){return this.native.href;}
  toJSON(){return this.native.href;}
  static canParse(value:string,base?:string){return NativeURL.canParse(value,base);}
  static parse(value:string,base?:string){try{return new SandboxURL(value,base);}catch{return null;}}
  static createObjectURL(value:Blob|MediaSource){return NativeURL.createObjectURL(value);}
  static revokeObjectURL(value:string){NativeURL.revokeObjectURL(value);}
}

function installFirefoxStreamsShim(): void {
  const g = globalThis as FlaggedGlobal;
  if (g[PATCH_FLAG]) return;
  // The polyfill is portable JS and there's no harm replacing the
  // globals everywhere — but the actual *bug* only fires in Firefox
  // content scripts. On Chrome / Safari content scripts, on the
  // Firefox options / popup page (extension-realm, not content-script
  // realm) the native WebIDL streams work fine, so we leave them
  // alone there.
  // This module is imported only by the isolated content entry, never by
  // extension pages or MAIN-world bundles. Install directly in that realm.
  console.info("[xgoose-fx-shim] installing same-realm Web API adapters");
  Object.defineProperty(g,"URL",{value:SandboxURL,writable:true,configurable:true});
  Object.defineProperty(g,"URLSearchParams",{value:SandboxURLSearchParams,writable:true,configurable:true});
  Object.defineProperty(g, "TransformStream", {
    value: PonyTransformStream,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(g, "ReadableStream", {
    value: PonyReadableStream,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(g, "WritableStream", {
    value: PonyWritableStream,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(g, "TextDecoderStream", {
    value: SandboxTextDecoderStream as unknown as typeof TextDecoderStream,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(g, "Headers", {
    value: SandboxHeaders as unknown as typeof Headers,
    writable: true,
    configurable: true,
  });
  g[PATCH_FLAG] = true;
}

// Run as a side-effect at module-load time. The shim MUST be in place
// before any other bundled module body evaluates — particularly the AI
// SDK's `var EventSourceParserStream = class extends TransformStream`
// (and the various `new Headers(…)` / `new TextDecoderStream(…)` sites
// that capture the constructor at construction time). esbuild's IIFE
// bundle evaluates modules in dependency order, so importing this file
// FIRST from `content/index.ts` (before any other import) guarantees
// the shim wins the race.
//
// Calling install() at content/index.ts's top-level (the previous
// approach) was too late: ES module top-level *statements* run only
// after ALL module bodies have completed initialisation — by which
// point the AI SDK's TransformStream subclasses were already captured
// against the native WebIDL constructor.
installFirefoxStreamsShim();
