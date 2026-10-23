/** Obergrenze beim Entpacken fremder Daten (Schutz vor Zip-Bombs). */
export const MAX_INFLATED_BYTES = 80 * 1024 * 1024;

export async function gzipString(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Liest einen Byte-Stream als Text, bricht aber oberhalb des Limits ab. */
export async function readCapped(stream: ReadableStream<Uint8Array>, max = MAX_INFLATED_BYTES): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error('Daten sind zu groß');
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

// --- Link mit eingebetteten Daten (#g=…), kompatibel zu Links der alten Version (pako/zlib) ---

export async function deflateToBase64Url(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function inflateFromBase64Url(b64: string): Promise<string> {
  let s = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return readCapped(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')));
}
