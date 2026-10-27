import { parseArgs } from 'node:util';
import { CodexConnection } from '../lib/codex.ts';
import { errorMessage, isRecord } from '../lib/codex-protocol.ts';
import { setThreadTitle } from '../lib/host-tools.ts';

// Explicit administrative entry; never a fallback for a missing host MCP tool.
let connection: CodexConnection | undefined;
try {
  const { values } = parseArgs({ options: {
    socket: { type: 'string' }, 'thread-id': { type: 'string' }, title: { type: 'string' },
  } });
  if (!values.socket || !values['thread-id'] || values.title === undefined) throw new Error('需要 --socket、--thread-id 和 --title。');
  connection = new CodexConnection(values.socket);
  await connection.connect();
  const result = await setThreadTitle(connection, values['thread-id'], { title: values.title });
  console.log(JSON.stringify({ success: true, ...result }));
} catch (cause) {
  console.error(JSON.stringify({ success: false, message: errorMessage(cause), uncertain: isRecord(cause) && cause.uncertain === true }));
  process.exitCode = 1;
} finally {
  connection?.close();
}
