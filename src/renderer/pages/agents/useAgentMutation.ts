import { useLayoutEffect, useRef, useState } from 'react';
import type { AgentChange, AgentMutationPorts, AgentReceipt, AgentScope } from './agent-model.ts';
import { agentError, isAgentScopeCurrent, validAgentScope } from './agent-model.ts';

function validReceipt(change: AgentChange, receipt: AgentReceipt): boolean {
  return !!receipt && receipt.operationId === change.operationId && ['confirmed', 'rejected', 'conflict', 'unknown'].includes(receipt.state) &&
    (receipt.state !== 'confirmed' ? typeof receipt.message === 'string' : !!receipt.agentId &&
      (!(change.kind === 'save' || change.kind === 'publish') || 'revision' in receipt &&
        (receipt.revision === null || typeof receipt.revision === 'string' || typeof receipt.revision === 'number' && Number.isFinite(receipt.revision))) &&
      (!(change.kind === 'save' || change.kind === 'publish' || change.kind === 'delete' || change.kind === 'pin' || change.kind === 'share') || receipt.agentId === change.agentId) &&
      (change.kind !== 'duplicate' || receipt.agentId !== change.agentId));
}

function sameOwner(change: AgentChange, scope: AgentScope): boolean {
  return validAgentScope(change) && change.hostId === scope.hostId && change.identity.accountId === scope.identity.accountId &&
    change.identity.userId === scope.identity.userId && typeof change.operationId === 'string' && !!change.operationId;
}

export function useAgentMutation(scope: AgentScope, ports: AgentMutationPorts) {
  const alive = useRef(false);
  const busyRef = useRef(false);
  const pendingId = useRef<string | null>(null);
  const pendingChange = useRef<AgentChange | null>(null);
  const expectedIds = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => {
    if (ports.hasUnresolvedChanges) for (const id of ports.unresolvedOperationIds ?? []) if (typeof id === 'string' && id) expectedIds.current.add(id);
  }, [ports.hasUnresolvedChanges, ports.unresolvedOperationIds]);

  const execute = async (change: AgentChange): Promise<AgentReceipt | null> => {
    if (!ports.onChange || !isAgentScopeCurrent(ports, scope) || busyRef.current || pendingId.current || uncertain || ports.hasUnresolvedChanges) return null;
    let request: AgentChange;
    try { request = structuredClone(change); }
    catch (cause) { setError(`Could not prepare the change: ${agentError(cause)}`); return null; }
    busyRef.current = true; setBusy(true); setError(null); setConflict(false);
    try {
      const receipt = await ports.onChange(structuredClone(request));
      if (!validReceipt(request, receipt)) throw new Error('Invalid operation receipt.');
      if (!alive.current || !isAgentScopeCurrent(ports, scope)) return null;
      if (receipt.state === 'unknown') { pendingId.current = request.operationId; pendingChange.current = request; setUncertain(true); setError(receipt.message); }
      else if (receipt.state === 'conflict') { setConflict(true); setError(receipt.message); }
      else if (receipt.state === 'rejected') setError(receipt.message);
      else if (receipt.state === 'confirmed') {
        try { await ports.onConfirmed?.(structuredClone(request), receipt); }
        catch (cause) {
          if (alive.current && isAgentScopeCurrent(ports, scope)) { pendingId.current = request.operationId; pendingChange.current = request; setUncertain(true); setError(`The change was confirmed, but its local state could not be updated: ${agentError(cause)}`); }
          return null;
        }
      }
      return alive.current && isAgentScopeCurrent(ports, scope) ? receipt : null;
    } catch (cause) {
      if (alive.current && isAgentScopeCurrent(ports, scope)) { pendingId.current = request.operationId; pendingChange.current = request; setUncertain(true); setError(`The result could not be confirmed: ${agentError(cause)}`); }
      return { operationId: request.operationId, state: 'unknown', message: agentError(cause) };
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };

  const check = async (acceptRecovered: (change: AgentChange) => boolean) => {
    if (!ports.onCheckChanges || !isAgentScopeCurrent(ports, scope) || busyRef.current) return null;
    busyRef.current = true; setBusy(true);
    try {
      const result = await ports.onCheckChanges(scope);
      if (!result || typeof result.pending !== 'boolean' || !Array.isArray(result.resolved)) throw new Error('Invalid reconciliation result.');
      let change = pendingChange.current;
      const matches = change ? result.resolved.filter(item => item?.change?.operationId === change!.operationId) :
        result.resolved.filter(item => item && sameOwner(item.change, scope) && expectedIds.current.has(item.change.operationId) && acceptRecovered(item.change));
      if (matches.length > 1) throw new Error('Multiple changes need separate confirmation.');
      const entry = matches[0];
      if (!change && entry) change = entry.change;
      const matched = entry?.receipt;
      if (matched && (!change || !validReceipt(change, matched) || matched.state === 'unknown')) throw new Error('The operation receipt could not be verified.');
      if (!result.pending && (pendingId.current || ports.hasUnresolvedChanges || uncertain) && !matched) throw new Error('The pending operation has not been verified.');
      if (!alive.current || !isAgentScopeCurrent(ports, scope)) return null;
      if (matched && change) { pendingId.current = null; pendingChange.current = null; expectedIds.current.delete(change.operationId); }
      setUncertain(result.pending); setConflict(matched?.state === 'conflict');
      setError(result.pending ? 'The change is still awaiting confirmation.' : matched && matched.state !== 'confirmed' ? matched.message : null);
      return matched && change ? { change, receipt: matched } : null;
    } catch (cause) { if (alive.current) { setUncertain(true); setError(`Could not check changes: ${agentError(cause)}`); } }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
    return null;
  };
  return { busy, locked: busy || uncertain || ports.hasUnresolvedChanges, uncertain: uncertain || ports.hasUnresolvedChanges, error, conflict, execute, check,
    clearConflict: () => { setConflict(false); setError(null); } };
}
