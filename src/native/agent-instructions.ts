import { posix, win32 } from 'node:path';

export const agentInstructionsLimit = 10 * 1024 * 1024;
export type AgentInstructionsFile = 'AGENTS.md' | 'AGENTS.override.md';
export interface AgentInstructionsSave {
  hostId: string;
  fileName: AgentInstructionsFile;
  contents: string;
  expectedContents: string | null;
}

export interface AgentInstructionsAccess {
  resolveHome(hostId: string): Promise<string>;
  // Must enforce maxBytes during the read, decode UTF-8 strictly, and return null only for a missing file.
  readText(hostId: string, path: string, maxBytes: number): Promise<string | null>;
  writeBytes(hostId: string, path: string, bytes: Uint8Array): Promise<void>;
}

function validText(value: unknown, nullable = false): value is string | null {
  return nullable && value === null || typeof value === 'string' &&
    Buffer.byteLength(value, 'utf8') <= agentInstructionsLimit && Buffer.from(value, 'utf8').toString('utf8') === value;
}

export function createAgentInstructions(access: AgentInstructionsAccess) {
  let pending: Promise<void> = Promise.resolve();
  async function write(request: AgentInstructionsSave): Promise<{ saved: true }> {
    const home = await access.resolveHome(request.hostId);
    if (typeof home !== 'string' || home.includes('\0') || !home || !posix.isAbsolute(home) && !win32.isAbsolute(home)) {
      throw new Error('The selected host did not provide an absolute Codex home.');
    }
    const path = (home.startsWith('/') ? posix : win32).join(home, request.fileName);
    const current = await access.readText(request.hostId, path, agentInstructionsLimit);
    if (!validText(current, true)) throw new Error('The instructions file is not valid UTF-8 or exceeds 10 MiB.');
    if (current !== request.expectedContents) throw new Error('Instructions changed on the host. Refresh and review them before saving.');
    try { await access.writeBytes(request.hostId, path, Buffer.from(request.contents, 'utf8')); }
    catch (error) { throw new Error(`Could not confirm the instructions write: ${error instanceof Error ? error.message : String(error)}. Refresh before retrying.`); }
    let after: string | null;
    try { after = await access.readText(request.hostId, path, agentInstructionsLimit); }
    catch (error) { throw new Error(`Could not confirm the saved instructions: ${error instanceof Error ? error.message : String(error)}. Refresh before retrying.`); }
    if (after !== request.contents) throw new Error('The saved instructions could not be confirmed. Refresh before retrying.');
    return { saved: true };
  }
  return {
    save(request: AgentInstructionsSave): Promise<{ saved: true }> {
      if (!request || typeof request.hostId !== 'string' || !request.hostId ||
        request.fileName !== 'AGENTS.md' && request.fileName !== 'AGENTS.override.md' ||
        !validText(request.contents) || !validText(request.expectedContents, true)) {
        return Promise.reject(new Error('Invalid instructions request or text exceeds 10 MiB.'));
      }
      // A single queue also covers different host aliases or symlinks to the same file.
      const copy = { hostId: request.hostId, fileName: request.fileName, contents: request.contents, expectedContents: request.expectedContents };
      const result = pending.then(() => write(copy));
      pending = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
