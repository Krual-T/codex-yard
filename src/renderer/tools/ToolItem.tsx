import { FileCode2, Globe2, Image as ImageIcon, Network, TerminalSquare, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ThreadItemSummary } from '../../../lib/codex-protocol.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { CopyButton } from '../messages/CopyButton.tsx';
import { MessageImage } from '../messages/MessageImage.tsx';
import { asArray, asRecord, asString, displayJson, imageFromGeneration, resolveFilePath, safeExternalUrl } from '../messages/message-data.ts';
import type { ImageSource } from '../messages/message-data.ts';

export type ToolItemProps = {
  item: ThreadItemSummary;
  client: WorkbenchClient;
  hostId: string;
  cwd: string;
  onOpenFile?: (path: string) => void;
  onOpenImage: (image: ImageSource) => void;
};

function DataBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === '') return null;
  const text = displayJson(value);
  return <section className="yard-tool-block"><div className="yard-tool-block-heading"><strong>{label}</strong>
    <CopyButton text={text} label={`Copy ${label.toLowerCase()}`} /></div><pre>{text}</pre></section>;
}

function ToolFrame({ icon, title, status, children }: { icon: ReactNode; title: string; status?: string; children: ReactNode }) {
  return <details className="yard-tool"><summary><span className="yard-tool-icon">{icon}</span>
    <span className="yard-tool-title">{title}</span>{status && <span className="yard-tool-status">{status}</span>}</summary>
    <div className="yard-tool-content">{children}</div></details>;
}

export function ToolItem({ item, client, hostId, cwd, onOpenFile, onOpenImage }: ToolItemProps) {
  const status = asString(item.status);
  if (item.type === 'commandExecution') {
    const command = asString(item.command);
    return <ToolFrame icon={<TerminalSquare size={16} />} title={command || 'Command'} status={status}>
      <DataBlock label="Command" value={command} /><DataBlock label="Working directory" value={item.cwd} />
      <DataBlock label="Output" value={item.aggregatedOutput} />
      {typeof item.exitCode === 'number' && <div>Exit code: {item.exitCode}</div>}
      {typeof item.durationMs === 'number' && <div>Duration: {item.durationMs} ms</div>}
    </ToolFrame>;
  }
  if (item.type === 'fileChange') return <ToolFrame icon={<FileCode2 size={16} />} title="File changes" status={status}>
    {asArray(item.changes).map((value, index) => {
      const change = asRecord(value);
      const path = asString(change.path);
      const kind = asString(asRecord(change.kind).type);
      return <section className="yard-file-change" key={`${path}-${index}`}><div className="yard-file-change-heading">
        {onOpenFile && path ? <button type="button" className="yard-file-link" onClick={() => onOpenFile(resolveFilePath(path, cwd))}>{path}</button> : <span>{path || 'Unknown file'}</span>}
        {kind && <span>{kind}</span>}</div><DataBlock label="Diff" value={change.diff} />
        {asString(asRecord(change.kind).move_path) && <div>Moved to: {asString(asRecord(change.kind).move_path)}</div>}
      </section>;
    })}
  </ToolFrame>;
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
    const owner = asString(item.server) || asString(item.namespace);
    const title = [owner, asString(item.tool)].filter(Boolean).join(' / ') || 'Tool call';
    const result = asRecord(item.result);
    return <ToolFrame icon={<Wrench size={16} />} title={title} status={status}>
      <DataBlock label="Arguments" value={item.arguments} />
      {asArray(result.content).map((value, index) => {
        const content = asRecord(value);
        if (content.type === 'text' && typeof content.text === 'string') return <DataBlock key={index} label="Output" value={content.text} />;
        if (content.type === 'image' && typeof content.data === 'string' && typeof content.mimeType === 'string') {
          const source: ImageSource = { kind: 'url', value: `data:${content.mimeType};base64,${content.data}`, label: 'Tool image' };
          return <MessageImage key={index} source={source} client={client} hostId={hostId} cwd={cwd} onOpen={() => onOpenImage(source)} />;
        }
        return <DataBlock key={index} label="Output" value={value} />;
      })}
      <DataBlock label="Structured result" value={result.structuredContent} /><DataBlock label="Result metadata" value={result._meta} />
      <DataBlock label="Error" value={item.error} />
      {asArray(item.contentItems).map((value, index) => {
        const content = asRecord(value);
        if (content.type === 'inputText') return <DataBlock key={index} label="Output" value={content.text} />;
        if (content.type === 'inputImage' && typeof content.imageUrl === 'string') {
          const source: ImageSource = { kind: 'url', value: content.imageUrl, label: 'Tool image' };
          return <MessageImage key={index} source={source} client={client} hostId={hostId} cwd={cwd} onOpen={() => onOpenImage(source)} />;
        }
        return <DataBlock key={index} label="Output" value={value} />;
      })}
      {typeof item.success === 'boolean' && <div>{item.success ? 'Succeeded' : 'Failed'}</div>}
      {typeof item.durationMs === 'number' && <div>Duration: {item.durationMs} ms</div>}
    </ToolFrame>;
  }
  if (item.type === 'webSearch') return <ToolFrame icon={<Globe2 size={16} />} title={`Search: ${asString(item.query)}`}>
    <DataBlock label="Action" value={item.action} />
    {asArray(item.results).map((value, index) => {
      const result = asRecord(value);
      const link = safeExternalUrl(asString(result.url));
      return <section className="yard-search-result" key={index}>{link && <a href={link} target="_blank" rel="noreferrer noopener">{asString(result.title) || link}</a>}
        <DataBlock label="Result" value={value} /></section>;
    })}
  </ToolFrame>;
  if (item.type === 'imageView' || item.type === 'imageGeneration') {
    const image: ImageSource | null = item.type === 'imageView' && typeof item.path === 'string'
      ? { kind: 'path', value: item.path, label: 'Viewed image' } : imageFromGeneration(item);
    return <ToolFrame icon={<ImageIcon size={16} />} title={item.type === 'imageView' ? 'Viewed image' : 'Generated image'} status={status}>
      {image && <MessageImage source={image} client={client} hostId={hostId} cwd={cwd} onOpen={() => onOpenImage(image)} />}
      <DataBlock label="Path" value={item.path ?? item.savedPath} /><DataBlock label="Prompt" value={item.revisedPrompt} />
      <DataBlock label="Error" value={item.failure} />{!image && <div>Image is not available yet.</div>}
    </ToolFrame>;
  }
  if (item.type === 'collabAgentToolCall' || item.type === 'subAgentActivity') return <ToolFrame icon={<Network size={16} />}
    title={item.type === 'subAgentActivity' ? `Agent ${asString(item.kind) || 'activity'}` : `Agent ${asString(item.tool) || 'task'}`} status={status}>
    <DataBlock label="Prompt" value={item.prompt} /><DataBlock label="Agents" value={item.agentsStates ?? item.receiverThreadIds} />
    <DataBlock label="Details" value={item} />
  </ToolFrame>;
  if (item.type === 'functionCallOutput') return <ToolFrame icon={<Wrench size={16} />}
    title={[asString(item.namespace), asString(item.name)].filter(Boolean).join(' / ') || 'Function output'}>
    <DataBlock label="Output" value={item.output} />
  </ToolFrame>;
  if (item.type === 'enteredReviewMode' || item.type === 'exitedReviewMode') return <ToolFrame icon={<FileCode2 size={16} />}
    title={item.type === 'enteredReviewMode' ? 'Review started' : 'Review finished'}><DataBlock label="Review" value={item.review} /></ToolFrame>;
  if (item.type === 'contextCompaction') return <ToolFrame icon={<Wrench size={16} />} title="Context compacted"><span>Conversation context was compacted.</span></ToolFrame>;
  if (item.type === 'sleep') return <ToolFrame icon={<Wrench size={16} />} title="Wait">
    {typeof item.durationMs === 'number' && <div>Duration: {item.durationMs} ms</div>}</ToolFrame>;
  return <ToolFrame icon={<Wrench size={16} />} title={`Unknown item: ${item.type || '(missing type)'}`} status={status}>
    <DataBlock label="Item data" value={item} />
  </ToolFrame>;
}
