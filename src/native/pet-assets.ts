import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { record } from './protocol.ts';

export interface CustomPetAvatar {
  id: string;
  displayName: string;
  description?: string;
  directoryPath: string;
  spriteVersionNumber: 1 | 2;
  spritesheetDataUrl: string;
  updatedAt: number;
}

function childPath(directory: string, name: string) {
  const path = resolve(directory, name), child = relative(directory, path);
  return child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child) ? path : null;
}

function imageSize(bytes: Buffer): { mime: string; width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return { mime: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + length > bytes.length) return null;
    if (kind === 'VP8X' && length >= 10) return { mime: 'image/webp', width: bytes.readUIntLE(start + 4, 3) + 1, height: bytes.readUIntLE(start + 7, 3) + 1 };
    if (kind === 'VP8L' && length >= 5 && bytes[start] === 47) {
      const bits = bytes.readUInt32LE(start + 1);
      return { mime: 'image/webp', width: bits % 16384 + 1, height: Math.floor(bits / 16384) % 16384 + 1 };
    }
    if (kind === 'VP8 ' && length >= 10 && bytes[start + 3] === 157 && bytes[start + 4] === 1 && bytes[start + 5] === 42) {
      return { mime: 'image/webp', width: bytes.readUInt16LE(start + 6) % 16384, height: bytes.readUInt16LE(start + 8) % 16384 };
    }
    offset = start + length + length % 2;
  }
  return null;
}

// The installed App reads pets/<id>/pet.json and the older avatars/<id>/avatar.json.
// Keep this service read-only: opening the Web picker must not create or install pets.
export function createPetAssets(codexHome: string) {
  async function readAvatar(parent: string, name: string, manifestName: string): Promise<CustomPetAvatar | null> {
    const directory = childPath(parent, name);
    if (!directory || /[/\\]/.test(name)) return null;
    try {
      const manifestPath = join(directory, manifestName);
      const manifest = record(JSON.parse(await readFile(manifestPath, 'utf8')));
      if (manifest.spritesheetPath !== undefined && typeof manifest.spritesheetPath !== 'string' ||
        manifest.spriteVersionNumber !== undefined && manifest.spriteVersionNumber !== 1 && manifest.spriteVersionNumber !== 2) return null;
      const spritePath = childPath(directory, typeof manifest.spritesheetPath === 'string' ? manifest.spritesheetPath : 'spritesheet.webp');
      if (!spritePath) return null;
      const [root, actual] = await Promise.all([realpath(directory), realpath(spritePath)]);
      if (!actual.startsWith(root + sep)) return null;
      const [spriteInfo, manifestInfo] = await Promise.all([stat(actual), stat(manifestPath)]);
      if (!spriteInfo.isFile() || spriteInfo.size > 20 * 1024 * 1024) return null;
      const bytes = await readFile(actual);
      const image = imageSize(bytes);
      if (!image || image.width !== 1536 || image.height !== (manifest.spriteVersionNumber === 2 ? 2288 : 1872)) return null;
      return { id: 'custom:' + name, directoryPath: directory,
        displayName: typeof manifest.displayName === 'string' ? manifest.displayName : typeof manifest.id === 'string' ? manifest.id : name,
        description: typeof manifest.description === 'string' ? manifest.description : undefined,
        spriteVersionNumber: manifest.spriteVersionNumber === 2 ? 2 : 1,
        spritesheetDataUrl: `data:${image.mime};base64,${bytes.toString('base64')}`,
        updatedAt: Math.max(spriteInfo.mtimeMs, manifestInfo.mtimeMs) };
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '') || error instanceof SyntaxError) return null;
      throw error;
    }
  }
  async function loadAvatar(id: string) {
    if (!id.startsWith('custom:')) return null;
    return await readAvatar(join(codexHome, 'pets'), id.slice(7), 'pet.json') ??
      await readAvatar(join(codexHome, 'avatars'), id.slice(7), 'avatar.json');
  }
  async function list(directory: string, manifest: string) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const avatars: CustomPetAvatar[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const avatar = await readAvatar(directory, entry.name, manifest);
        if (avatar) avatars.push(avatar);
      }
      return avatars;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  async function load() {
    const avatars = new Map<string, CustomPetAvatar>();
    for (const [folder, manifest] of [['avatars', 'avatar.json'], ['pets', 'pet.json']]) {
      for (const avatar of await list(join(codexHome, folder), manifest)) avatars.set(avatar.id, avatar);
    }
    return { avatarDirectory: join(codexHome, 'pets'), avatars: [...avatars.values()].sort((a, b) => b.updatedAt - a.updatedAt) };
  }
  return { load, loadAvatar };
}
