import { FileCode2, Globe2, Image as ImageIcon, Network, TerminalSquare, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ThreadItemSummary } from '../../../lib/codex-protocol.ts';
import type { StandaloneMessagesProps, WorkbenchClient } from '../workbench-contract.ts';
import { CopyButton } from '../messages/CopyButton.tsx';
import { MessageImage } from '../messages/MessageImage.tsx';
import { asArray, asRecord, asString, displayJson, imageFromGeneration, resolveToolFileLocation, safeExternalUrl } from '../messages/message-data.ts';
import type { ImageSource } from '../messages/message-data.ts';

export type ToolItemProps = {
  item: ThreadItemSummary;
  client: WorkbenchClient;
  hostId: string;
  threadId: string;
  cwd: string;
  onOpenFile?: StandaloneMessagesProps['onOpenFile'];
  onOpenFileAt?: StandaloneMessagesProps['onOpenFileAt'];
  onOpenBrowser?: StandaloneMessagesProps['onOpenBrowser'];
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

type FileLinkProps = Pick<ToolItemProps, 'hostId' | 'cwd' | 'onOpenFile' | 'onOpenFileAt'> & { path: string; children?: ReactNode };
function FileLink({ path, hostId, cwd, onOpenFile, onOpenFileAt, children }: FileLinkProps) {
  if (!onOpenFile && !onOpenFileAt) return <span>{children ?? path}</span>;
  return <button type="button" className="yard-file-link" onClick={() => {
    const location = resolveToolFileLocation(path, cwd, hostId);
    if (onOpenFileAt) onOpenFileAt(location); else onOpenFile?.(location.path);
  }}>{children ?? path}</button>;
}

type BrowserLinkProps = Pick<ToolItemProps, 'hostId' | 'threadId' | 'onOpenBrowser'> & { url: string; children?: ReactNode };
function BrowserLink({ url, hostId, threadId, onOpenBrowser, children }: BrowserLinkProps) {
  const safe = safeExternalUrl(url);
  if (!safe || !/^https?:\/\//i.test(safe)) return <span>{children ?? url}</span>;
  return onOpenBrowser
    ? <button type="button" className="yard-file-link" onClick={() => onOpenBrowser({ hostId, threadId, url: safe, source: 'link' })}>{children ?? safe}</button>
    : <a href={safe} target="_blank" rel="noreferrer noopener">{children ?? safe}</a>;
}

export function ToolItem({ item, client, hostId, threadId, cwd, onOpenFile, onOpenFileAt, onOpenBrowser, onOpenImage }: ToolItemProps) {
  const fileProps = { hostId, cwd, onOpenFile, onOpenFileAt };
  const browserProps = { hostId, threadId, onOpenBrowser };
  const status = asString(item.status);
  if (item.type === 'commandExecution') {
    const command = asString(item.command);
    return <ToolFrame icon={<TerminalSquare size={16} />} title={command || 'Command'} status={status}>
      <DataBlock label="Command" value={command} /><DataBlock label="Working directory" value={item.cwd} />
      {asArray(item.commandActions).map((value, index) => {
        const action = asRecord(value);
        const path = asString(action.path);
        const type = asString(action.type);
        if (!['read', 'listFiles', 'search'].includes(type)) return <DataBlock key={index} label="Command action" value={value} />;
        const actionCwd = asString(item.cwd) || cwd;
        return <div className="yard-command-action" key={index}><strong>{type === 'read' ? 'Read' : type === 'listFiles' ? 'List files' : 'Search'}</strong>
          {asString(action.query) && <span>{asString(action.query)}</span>}
          {path && <FileLink {...fileProps} cwd={actionCwd} path={path}>{asString(action.name) || path}</FileLink>}
        </div>;
      })}
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
        {path ? <FileLink {...fileProps} path={path} /> : <span>Unknown file</span>}
        {kind && <span data-kind={kind}>{kind}</span>}</div><DataBlock label="Diff" value={change.diff} />
        {asString(asRecord(change.kind).move_path) && <div>Moved to: {asString(asRecord(change.kind).move_path)}</div>}
      </section>;
    })}
  </ToolFrame>;
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
    const owner = asString(item.server) || asString(item.namespace);
    const title = [owner, asString(item.tool)].filter(Boolean).join(' / ') || 'Tool call';
    const result = asRecord(item.result);
    const appUi = asRecord(item.mcpAppUi);
    const appResource = asString(appUi.resourceUri) || asString(item.mcpAppResourceUri);
    const appMode = asString(appUi.preferredModelDisplayMode);
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
      <DataBlock label="Error" value={asString(asRecord(item.error).message) || item.error} />
      {appResource && <div>Interactive tool view unavailable: {appResource}
        {(appMode === 'inline' || appMode === 'fullscreen') && <> ({appMode})</>}</div>}
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
  if (item.type === 'webSearch') {
    const action = asRecord(item.action);
    const actionType = asString(action.type);
    const url = asString(action.url);
    return <ToolFrame icon={<Globe2 size={16} />} title={`Search: ${asString(item.query)}`}>
    {actionType === 'search' && <div className="yard-web-action"><strong>Search</strong>
      {[asString(action.query), ...asArray(action.queries).filter((value): value is string => typeof value === 'string')]
        .filter((value, index, all) => value && all.indexOf(value) === index).map((value) => <div key={value}>{value}</div>)}</div>}
    {(actionType === 'openPage' || actionType === 'findInPage') && <div className="yard-web-action">
      <strong>{actionType === 'openPage' ? 'Open page' : 'Find in page'}</strong>{url && <>: <BrowserLink {...browserProps} url={url} /></>}
      {asString(action.pattern) && <div>Find: {asString(action.pattern)}</div>}</div>}
    {actionType && !['search', 'openPage', 'findInPage'].includes(actionType) && <DataBlock label="Action" value={item.action} />}
    {asArray(item.results).map((value, index) => {
      const result = asRecord(value);
      const link = asString(result.url);
      return <section className="yard-search-result" key={index}>{link && <BrowserLink {...browserProps} url={link}>{asString(result.title) || link}</BrowserLink>}
        {asString(result.snippet) && <div>{asString(result.snippet)}</div>}
        <DataBlock label="Result data" value={value} /></section>;
    })}
    </ToolFrame>;
  }
  if (item.type === 'imageView' || item.type === 'imageGeneration') {
    const image: ImageSource | null = item.type === 'imageView' && typeof item.path === 'string'
      ? { kind: 'path', value: item.path, label: 'Viewed image' } : imageFromGeneration(item);
    return <ToolFrame icon={<ImageIcon size={16} />} title={item.type === 'imageView' ? 'Viewed image' : 'Generated image'} status={status}>
      {image && <MessageImage source={image} client={client} hostId={hostId} cwd={cwd} onOpen={() => onOpenImage(image)} />}
      <DataBlock label="Path" value={item.path ?? item.savedPath} /><DataBlock label="Prompt" value={item.revisedPrompt} />
      <DataBlock label="Error" value={item.failure} />{!image && <div>Image is not available yet.</div>}
    </ToolFrame>;
  }
  if (item.type === 'collabAgentToolCall' || item.type === 'subAgentActivity') {
    const states = asRecord(item.agentsStates);
    const receivers = asArray(item.receiverThreadIds).filter((value): value is string => typeof value === 'string');
    const agents = [...new Set([...receivers, ...Object.keys(states)])];
    return <ToolFrame icon={<Network size={16} />}
      title={item.type === 'subAgentActivity' ? `Agent ${asString(item.kind) || 'activity'}` : `Agent ${asString(item.tool) || 'task'}`} status={status}>
      {asString(item.senderThreadId) && <div>From: {asString(item.senderThreadId)}</div>}
      {asString(item.agentThreadId) && <div>Agent: {asString(item.agentThreadId)}</div>}
      {asString(item.agentPath) && <div>Path: {asString(item.agentPath)}</div>}
      {asString(item.model) && <div>Model: {asString(item.model)}</div>}
      {asString(item.reasoningEffort) && <div>Reasoning effort: {asString(item.reasoningEffort)}</div>}
      <DataBlock label="Prompt" value={item.prompt} />
      {agents.length > 0 && <ul className="yard-agent-list">{agents.map((agent) => {
        const state = asRecord(states[agent]);
        return <li key={agent}><strong>{agent}</strong>{asString(state.status) && <>: {asString(state.status)}</>}
          {asString(state.message) && <div>{asString(state.message)}</div>}</li>;
      })}</ul>}
    </ToolFrame>;
  }
  if (item.type === 'functionCallOutput') return <ToolFrame icon={<Wrench size={16} />}
    title={[asString(item.namespace), asString(item.name)].filter(Boolean).join(' / ') || 'Function output'}>
    {typeof item.output === 'string' || !Array.isArray(item.output) ? <DataBlock label="Output" value={item.output} /> : item.output.map((value, index) => {
      const content = asRecord(value);
      if (content.type === 'input_text') return <DataBlock key={index} label="Output" value={content.text} />;
      if (content.type === 'input_image') {
        const source: ImageSource | null = typeof content.image_url === 'string'
          ? { kind: 'url', value: content.image_url, label: 'Tool image' }
          : typeof content.file_id === 'string' ? { kind: 'fileId', value: content.file_id, label: 'Tool image' } : null;
        if (source) return <MessageImage key={index} source={source} client={client} hostId={hostId} cwd={cwd} onOpen={() => onOpenImage(source)} />;
      }
      return <DataBlock key={index} label="Output" value={value} />;
    })}
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
