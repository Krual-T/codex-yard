import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Duplex, Readable, Transform, Writable } from 'node:stream';

export interface SshHost {
  hostId: string;
  displayName: string;
  sshAlias: string | null;
  sshHost: string;
  sshPort: number | null;
  identity: string | null;
}
export interface HostPaths { homeDirectory: string; codexHome: string }
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

// Some registered hosts install Node/Codex under ~/.nodejs without exporting
// that bin directory to noninteractive login shells. Keep PATH authoritative;
// only accept an unambiguous existing installation when codex is absent.
export const codexProxyEnvironment = [
  'PATH="${CODEX_INSTALL_DIR:-$HOME/.local/bin}:$PATH"; export PATH',
  'if ! command -v codex >/dev/null 2>&1; then',
  '  codex_proxy_bin=""',
  '  for codex_proxy_candidate in "$HOME"/.nodejs/*/bin; do',
  '    if [ -x "$codex_proxy_candidate/codex" ] && [ -x "$codex_proxy_candidate/node" ]; then',
  '      if [ -n "$codex_proxy_bin" ]; then printf "%s\\n" "多个 ~/.nodejs Codex 安装；请通过 PATH 或 CODEX_INSTALL_DIR 选择版本" >&2; exit 127; fi',
  '      codex_proxy_bin="$codex_proxy_candidate"',
  '    fi',
  '  done',
  '  if [ -n "$codex_proxy_bin" ]; then PATH="$codex_proxy_bin:$PATH"; export PATH; fi',
  'fi',
  'command -v codex >/dev/null 2>&1 || { printf "%s\\n" "未找到已有 Codex CLI，请检查远端 PATH 或 CODEX_INSTALL_DIR" >&2; exit 127; }',
].join('\n');

export function sshArguments(host: SshHost, tty = false) {
  const args = [tty ? '-tt' : '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];
  if (!host.sshAlias && host.identity) args.push('-i', host.identity);
  if (!host.sshAlias && host.sshPort) args.push('-p', String(host.sshPort));
  return [...args, '--', host.sshAlias || host.sshHost];
}

// The proxy carries the daemon's WebSocket bytes. Closing this stream only
// closes this client's SSH/proxy process, never the remote daemon or thread.
export function createSshProxyStream(host: SshHost, onPaths: (paths: HostPaths) => void = () => {}) {
  const marker = 'AGENTS_PROXY_' + randomBytes(12).toString('hex');
  const payload = [
    codexProxyEnvironment,
    'CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"; export CODEX_HOME',
    `printf '%s\\0%s\\0%s\\0' ${quote(marker)} "$HOME" "$CODEX_HOME"`,
    'exec codex app-server proxy',
  ].join('; ');
  const command = 'exec /bin/sh -c ' + quote('exec "${SHELL:-/bin/sh}" -l -c "$1"') + ' sh ' + quote('exec /bin/sh -c ' + quote(payload));
  const args = [...sshArguments(host), command];
  const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let prefix = Buffer.alloc(0), started = false, stderr = '';
  const output = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      if (started) { done(null, chunk); return; }
      prefix = Buffer.concat([prefix, chunk]);
      const at = prefix.indexOf(marker + '\0');
      const homeAt = at < 0 ? -1 : at + marker.length + 1;
      const homeEnd = homeAt < 0 ? -1 : prefix.indexOf(0, homeAt);
      const codexEnd = homeEnd < 0 ? -1 : prefix.indexOf(0, homeEnd + 1);
      if (codexEnd >= 0) {
        onPaths({ homeDirectory: prefix.subarray(homeAt, homeEnd).toString(), codexHome: prefix.subarray(homeEnd + 1, codexEnd).toString() });
        started = true;
        const remainder = prefix.subarray(codexEnd + 1);
        prefix = Buffer.alloc(0);
        done(null, remainder);
      } else if (prefix.length > 256 * 1024) done(new Error('SSH 登录输出过大，尚未进入 Codex proxy'));
      else done();
    },
  });
  const stream = Duplex.fromWeb({ readable: Readable.toWeb(child.stdout.pipe(output)), writable: Writable.toWeb(child.stdin) });
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4096); });
  child.once('error', error => stream.destroy(error));
  child.once('exit', code => {
    if (code && !stream.destroyed) stream.destroy(new Error(`SSH Codex proxy 退出 (${code})：${stderr.trim()}`));
  });
  stream.once('close', () => { child.kill(); output.destroy(); });
  return stream;
}
