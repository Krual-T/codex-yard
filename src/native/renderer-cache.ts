import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const compress = promisify(gzip);
interface Asset { content: Buffer; compressed?: Buffer }
interface Entry { result: Promise<Asset>; size: number }

/** Process-local cache for immutable renderer assets only. It also coalesces
 * concurrent adaptations and compression of the same fixed module. */
export class RendererCache {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  private readonly limit: number;

  constructor(limit = 64 * 1024 * 1024) { this.limit = limit; }

  load(key: string, read: () => Promise<Buffer>, compressible: boolean): Promise<Asset> {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.result;
    }
    const entry: Entry = { size: 0, result: Promise.resolve().then(async () => {
      const content = await read();
      const compressed = compressible && content.length > 1024 ? await compress(content, { level: 6 }) : undefined;
      if (this.entries.get(key) === entry) {
        entry.size = content.length + (compressed?.length ?? 0);
        this.bytes += entry.size;
        while (this.bytes > this.limit && this.entries.size) {
          const oldest = this.entries.entries().next().value!;
          this.entries.delete(oldest[0]);
          this.bytes -= oldest[1].size;
        }
      }
      return { content, compressed };
    }).catch(error => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }) };
    this.entries.set(key, entry);
    return entry.result;
  }
}
