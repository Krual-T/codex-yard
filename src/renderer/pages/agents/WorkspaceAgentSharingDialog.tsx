import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { AgentChange, AgentMutationPorts, AgentPermissions, AgentRecipient, AgentScope, AgentShareCapability, AgentSharingUpdate } from './agent-model.ts';
import { agentError, canEditAgent, isAgentScopeCurrent, validAgentScope } from './agent-model.ts';
import { useAgentMutation } from './useAgentMutation.ts';
import './workspace-agent.css';

export interface AgentInviteDraft { scope: AgentScope; agentId: string; revision: number; recipients: AgentRecipient[]; capability: AgentShareCapability }
export interface WorkspaceAgentSharingDialogProps extends AgentMutationPorts {
  scope: AgentScope | null;
  agentId: string;
  viewerCapability: string;
  published: boolean;
  canShare: boolean;
  canListInDirectory: boolean;
  canShareGroups: boolean;
  canSearchPeople: boolean;
  canSearchGroups: boolean;
  accountUserId: string;
  creatorId: string;
  invite: AgentInviteDraft;
  onInviteChange?: (scope: AgentScope, draft: AgentInviteDraft) => void;
  onLoadPermissions?: (request: AgentScope & { agentId: string; signal: AbortSignal }) => Promise<AgentPermissions>;
  onSearchRecipients?: (request: AgentScope & { agentId: string; query: string; people: boolean; groups: boolean; signal: AbortSignal }) => Promise<{ items: AgentRecipient[]; warnings: string[] }>;
  onCopyLink?: (request: AgentScope & { agentId: string }) => void | Promise<void>;
  onClose(): void;
}

const key = (entry: AgentRecipient) => `${entry.kind}:${entry.id}`;
function recipientValid(value: AgentRecipient): boolean {
  return !!value && (value.kind === 'users' || value.kind === 'groups') && typeof value.id === 'string' && !!value.id && typeof value.name === 'string' && (value.secondary === null || typeof value.secondary === 'string');
}
function permissionsValid(value: AgentPermissions, accountId: string): boolean {
  return !!value && (value.workspace === null || !!value.workspace && value.workspace.workspaceId === accountId &&
    (value.workspace.capability === null || value.workspace.capability === 'hermes_read_config' || value.workspace.capability === 'hermes_write') && typeof value.workspace.storeVisible === 'boolean') &&
    Array.isArray(value.entries) && value.entries.every(item => recipientValid(item) && ['hermes_read_config', 'hermes_write', 'hermes_admin'].includes(item.capability));
}

export function WorkspaceAgentSharingDialog(props: WorkspaceAgentSharingDialogProps) {
  const scope = props.scope;
  if (!validAgentScope(scope) || !props.agentId) return null;
  return <SharingScope key={JSON.stringify([scope.hostId, scope.identity.accountId, scope.identity.userId, scope.sessionKey, props.agentId])} {...props} scope={scope} />;
}

function SharingScope(props: WorkspaceAgentSharingDialogProps & { scope: AgentScope }) {
  const { scope, agentId, invite } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const removalTrigger = useRef<HTMLButtonElement | null>(null);
  const removalCancel = useRef<HTMLButtonElement>(null);
  const alive = useRef(false);
  const currentInvite = useRef(invite);
  const [permissions, setPermissions] = useState<AgentPermissions | null>(null);
  const [fresh, setFresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<{ items: AgentRecipient[]; warnings: string[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  const [remove, setRemove] = useState<AgentRecipient | null>(null);
  const mutation = useAgentMutation(scope, props);
  const admin = props.viewerCapability === 'hermes_admin';
  const allowed = props.canShare && props.published && !!props.accountUserId && !!props.creatorId && canEditAgent(props.viewerCapability);
  const inviteValid = invite && invite.agentId === agentId && invite.scope?.hostId === scope.hostId && invite.scope.identity?.accountId === scope.identity.accountId &&
    invite.scope.identity?.userId === scope.identity.userId && invite.scope.sessionKey === scope.sessionKey && Array.isArray(invite.recipients) &&
    Number.isSafeInteger(invite.revision) && invite.revision >= 0 && invite.recipients.every(recipientValid) && (invite.capability === 'hermes_read_config' || invite.capability === 'hermes_write');
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => { currentInvite.current = invite; }, [invite]);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { if (element?.open) element.close(); }; }, []);
  useEffect(() => { if (remove) removalCancel.current?.focus(); }, [remove]);
  useEffect(() => {
    if (!props.onLoadPermissions || !allowed) { setPermissions(null); setFresh(false); setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setLoadError(null); setFresh(false);
    void Promise.resolve().then(() => {
      if (!isAgentScopeCurrent(props, scope)) throw new Error('The active account changed.');
      return props.onLoadPermissions!({ ...scope, agentId, signal: controller.signal });
    }).then(value => {
      if (!permissionsValid(value, scope.identity.accountId)) throw new Error('Invalid agent permissions.');
      if (!controller.signal.aborted && isAgentScopeCurrent(props, scope)) { setPermissions(value); setFresh(true); }
    }).catch(cause => { if (!controller.signal.aborted && isAgentScopeCurrent(props, scope)) setLoadError(agentError(cause)); })
      .finally(() => { if (!controller.signal.aborted && isAgentScopeCurrent(props, scope)) setLoading(false); });
    return () => controller.abort();
  }, [refresh, props.onLoadPermissions, allowed]);
  useEffect(() => {
    const controller = new AbortController(); const text = query.trim();
    setSearch(null); setSearchError(null);
    if (!text || !allowed || !props.onSearchRecipients || !props.canSearchPeople && !(props.canSearchGroups && props.canShareGroups)) { setSearching(false); return () => controller.abort(); }
    setSearching(true);
    void Promise.resolve().then(() => {
      if (!isAgentScopeCurrent(props, scope)) throw new Error('The active account changed.');
      return props.onSearchRecipients!({ ...scope, agentId, query: text, people: props.canSearchPeople, groups: props.canSearchGroups && props.canShareGroups, signal: controller.signal });
    }).then(value => {
      if (!value || !Array.isArray(value.items) || !value.items.every(recipientValid) || !Array.isArray(value.warnings) || !value.warnings.every(message => typeof message === 'string')) throw new Error('Invalid recipient search.');
      if (!controller.signal.aborted && isAgentScopeCurrent(props, scope)) setSearch(value);
    }).catch(cause => { if (!controller.signal.aborted && isAgentScopeCurrent(props, scope)) setSearchError(agentError(cause)); })
      .finally(() => { if (!controller.signal.aborted && isAgentScopeCurrent(props, scope)) setSearching(false); });
    return () => controller.abort();
  }, [query, searchRetry, props.onSearchRecipients, props.canSearchPeople, props.canSearchGroups, props.canShareGroups, allowed]);
  const updateInvite = (next: AgentInviteDraft) => {
    if (!props.onInviteChange || !inviteValid || !isAgentScopeCurrent(props, scope)) return;
    try { const value = { ...next, revision: currentInvite.current.revision + 1 }; props.onInviteChange(scope, value); currentInvite.current = value; setActionError(null); }
    catch (cause) { setActionError(`Could not retain recipients: ${agentError(cause)}`); }
  };
  const finish = (change: AgentChange) => {
    if (!alive.current || !isAgentScopeCurrent(props, scope) || change.kind !== 'share') return;
    setRemove(null); setFresh(false); setRefresh(value => value + 1);
    if ('workspace' in change.update || change.inviteRevision === undefined || !inviteValid || currentInvite.current.revision !== change.inviteRevision) return;
    const applied = new Set([...Object.keys(change.update.users ?? {}).map(id => `users:${id}`), ...Object.keys(change.update.groups ?? {}).map(id => `groups:${id}`)]);
    updateInvite({ ...currentInvite.current, recipients: currentInvite.current.recipients.filter(item => !applied.has(key(item))) });
  };
  const check = async () => { const result = await mutation.check(value => value.kind === 'share' && value.agentId === agentId && !!value.update && typeof value.update === 'object'); if (result?.receipt.state === 'confirmed') finish(result.change); };
  const submit = async (update: AgentSharingUpdate, inviteRevision?: number) => {
    if (!allowed || !fresh || !props.onChange || mutation.locked || !isAgentScopeCurrent(props, scope)) return;
    const change: AgentChange = { ...scope, operationId: crypto.randomUUID(), kind: 'share', agentId, update, ...(inviteRevision === undefined ? {} : { inviteRevision }) };
    const result = await mutation.execute(change);
    if (result?.state === 'confirmed') finish(change);
  };
  const blocked = !allowed || !fresh || !props.onChange || mutation.locked;
  const present = new Set(permissions?.entries.map(key) ?? []);
  const selected = inviteValid ? invite.recipients : [];
  const candidates = (search?.items ?? []).filter(item => (item.kind === 'users' ? props.canSearchPeople && item.id !== props.accountUserId && item.id !== props.creatorId : props.canSearchGroups && props.canShareGroups) && !present.has(key(item)) && !selected.some(value => key(value) === key(item)));
  const recipients = selected.filter(item => !present.has(key(item)) && (item.kind === 'users' ? item.id !== props.accountUserId && item.id !== props.creatorId : props.canShareGroups));
  const inviteTargets = () => {
    const update: { users?: Record<string, AgentShareCapability>; groups?: Record<string, AgentShareCapability> } = {};
    for (const item of recipients) { const part = update[item.kind] ?? Object.create(null) as Record<string, AgentShareCapability>; part[item.id] = admin ? invite.capability : 'hermes_read_config'; update[item.kind] = part; }
    void submit(update, invite.revision);
  };
  const cancelRemoval = () => { setRemove(null); removalTrigger.current?.focus(); };
  return <dialog ref={dialog} className="yard-agent-modal" aria-labelledby="yard-agent-sharing-title" onCancel={event => { if (remove) { event.preventDefault(); cancelRemoval(); } else if (mutation.busy) event.preventDefault(); }} onClose={props.onClose}>
    <div className="yard-agent-section-head"><h2 id="yard-agent-sharing-title">Share agent</h2><button className="yard-agent-icon-button" type="button" aria-label="Close sharing" title="Close" disabled={mutation.busy} onClick={() => dialog.current?.close()}><X size={17} /></button></div>
    {!allowed && <p>Sharing is unavailable for this account.</p>}
    {allowed && !props.onLoadPermissions && <p>Agent permissions are unavailable on this host.</p>}
    {loading && <p role="status">Loading permissions...</p>}
    {loadError && <p role="alert">Could not load permissions: {loadError} <button className="yard-agent-btn" type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button></p>}
    {actionError && <p role="alert">{actionError}</p>}{mutation.error && <p role="alert">{mutation.error}</p>}
    {mutation.uncertain && <p>A change is awaiting confirmation. <button className="yard-agent-btn" type="button" disabled={!props.onCheckChanges || mutation.busy} onClick={() => void check()}>Check changes</button></p>}
    {permissions && allowed && <>
      {permissions.workspace && <section className="yard-agent-section"><h3>Workspace access</h3>
        <label className="yard-agent-share-toggle"><input type="checkbox" checked={permissions.workspace.capability !== null} disabled={blocked || !admin} onChange={event => void submit({ workspace: { workspace_id: scope.identity.accountId, capability: event.target.checked ? 'hermes_read_config' : null, store_visible: event.target.checked && permissions.workspace!.storeVisible } })} /> Anyone in this workspace can chat</label>
        <label className="yard-agent-share-toggle"><input type="checkbox" checked={permissions.workspace.storeVisible} disabled={blocked || !admin || permissions.workspace.capability === null || !permissions.workspace.storeVisible && !props.canListInDirectory} onChange={event => void submit({ workspace: { workspace_id: scope.identity.accountId, capability: 'hermes_read_config', store_visible: event.target.checked } })} /> List in workspace directory</label>
      </section>}
      <section className="yard-agent-section"><h3>People and groups</h3>
        {!props.canSearchPeople && !(props.canSearchGroups && props.canShareGroups) ? <p>Your workspace permissions don't allow searching for people or groups.</p> : <label className="yard-agent-field">Search people and groups<input type="search" value={query} disabled={!allowed || !props.onSearchRecipients} onChange={event => setQuery(event.target.value)} /></label>}
        {searching && <p role="status">Searching...</p>}{searchError && <p role="alert">Could not search recipients: {searchError} <button className="yard-agent-btn" type="button" onClick={() => setSearchRetry(value => value + 1)}>Retry</button></p>}
        {search?.warnings.map((message, index) => <p role="status" key={index}>{message}</p>)}
        {query.trim() && search && !candidates.length && !search.warnings.length && <p>No matching recipients.</p>}
        {candidates.map(item => <button className="yard-agent-btn yard-agent-share-recipient" key={key(item)} type="button" disabled={blocked || !props.onInviteChange || !inviteValid} onClick={() => updateInvite({ ...invite, recipients: [...invite.recipients, item] })}>{item.name}{item.secondary ? ` (${item.secondary})` : ''}</button>)}
        {recipients.map(item => <button className="yard-agent-btn yard-agent-share-recipient" key={key(item)} type="button" disabled={blocked || !props.onInviteChange} onClick={() => updateInvite({ ...invite, recipients: invite.recipients.filter(value => key(value) !== key(item)) })} title="Remove recipient">{item.name} <X size={14} /></button>)}
        {recipients.length > 0 && <div className="yard-agent-actions"><label className="yard-agent-field">Permission<select aria-label="Invitation permission" value={admin ? invite.capability : 'hermes_read_config'} disabled={blocked || !admin || !props.onInviteChange} onChange={event => updateInvite({ ...invite, capability: event.target.value as AgentShareCapability })}><option value="hermes_read_config">Can chat</option><option value="hermes_write">Can edit</option></select></label><button className="yard-agent-btn yard-agent-btn-primary" type="button" disabled={blocked} onClick={inviteTargets}>Invite</button></div>}
        <ul className="yard-agent-list">{permissions.entries.map(entry => {
          const locked = blocked || entry.capability === 'hermes_admin' || entry.kind === 'users' && entry.id === props.creatorId || !admin && entry.capability === 'hermes_write' || entry.kind === 'groups' && !props.canShareGroups;
          return <li className="yard-agent-permission" key={key(entry)}><span>{entry.name}{entry.secondary && <small>{entry.secondary}</small>}</span><select aria-label={`Permission for ${entry.name}`} value={entry.capability} disabled={locked} onChange={event => void submit({ [entry.kind]: { [entry.id]: event.target.value as AgentShareCapability } })}><option value="hermes_read_config">Can chat</option><option value="hermes_write" disabled={!admin}>Can edit</option>{entry.capability === 'hermes_admin' && <option value="hermes_admin">Owner</option>}</select><button className="yard-agent-icon-button" type="button" aria-label={`Remove ${entry.name}`} title="Remove access" disabled={locked} onClick={event => { removalTrigger.current = event.currentTarget; setRemove(entry); }}><X size={16} /></button></li>;
        })}</ul>
      </section>
    </>}
    {remove && <section className="yard-agent-section" role="alertdialog" aria-label="Remove access"><h3>Remove access?</h3><p>Remove direct access for {remove.name}? They may still have access through the workspace or a group.</p><div className="yard-agent-actions"><button ref={removalCancel} className="yard-agent-btn" type="button" disabled={mutation.busy} onClick={cancelRemoval}>Cancel</button><button className="yard-agent-btn yard-agent-btn-primary" type="button" disabled={blocked} onClick={() => void submit({ [remove.kind]: { [remove.id]: null } })}>Remove access</button></div></section>}
    <footer><button className="yard-agent-btn" type="button" disabled={!props.onCopyLink} onClick={() => { void Promise.resolve().then(() => { if (isAgentScopeCurrent(props, scope)) return props.onCopyLink?.({ ...scope, agentId }); }).catch(cause => { if (alive.current) setActionError(agentError(cause)); }); }}>Copy link</button><button className="yard-agent-btn" type="button" disabled={mutation.busy} onClick={() => dialog.current?.close()}>Done</button></footer>
  </dialog>;
}
