export function makeStreamingResponse(
  status: number,
  headers: Record<string, string>,
  stream: ReadableStream<Uint8Array>,
): Response {
  let consumed = false;
  // Firefox's isolated realm uses a JavaScript stream: passing it to a native
  // Response loses its body. Read it directly so SDKs can inspect HTTP errors
  // (including context_length_exceeded) before deciding whether to retry.
  const consume = async (): Promise<Uint8Array> => {
    if (consumed || stream.locked) throw new TypeError("Response body already used");
    consumed = true;
    const reader = stream.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); length += value.byteLength;
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  };
  const fake = {
    status,
    statusText: "",
    ok: status >= 200 && status < 300,
    redirected: false,
    type: "basic" as const,
    url: "",
    headers: new Headers(headers),
    body: stream,
    get bodyUsed() { return consumed || stream.locked; },
    clone(): Response {
      throw new Error("streaming response is not cloneable");
    },
    async text(): Promise<string> {
      return new TextDecoder().decode(await consume());
    },
    async json(): Promise<unknown> {
      return JSON.parse(await fake.text());
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      return (await consume()).buffer as ArrayBuffer;
    },
    async blob(): Promise<Blob> {
      return new Blob([await fake.arrayBuffer()], {type: fake.headers.get('content-type') ?? ''});
    },
    async formData(): Promise<FormData> {
      throw new Error("streaming response: use .body instead of .formData()");
    },
    async bytes(): Promise<Uint8Array> {
      return consume();
    },
  };
  return fake as unknown as Response;
}
