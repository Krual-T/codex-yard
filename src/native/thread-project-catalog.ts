import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function conflict(a: unknown, b: unknown) {
  if (same(a, b)) return a;
  const entries = object(a) && a.$codexYardAssignmentConflict === 1 && Array.isArray(a.values) ? [...a.values] : [a];
  if (!entries.some(value => same(value, b))) entries.push(b);
  return { $codexYardAssignmentConflict: 1, values: entries };
}
function mergeLegacy(existing: unknown, incoming: ObjectValue): unknown {
  if (existing === undefined) return { ...incoming };
  if (!object(existing)) return { $codexYardUnreadableAssignments: 1, existing, incoming: { ...incoming } };
  if (existing.$codexYardUnreadableAssignments === 1) return { ...existing, incoming: mergeLegacy(existing.incoming, incoming) };
  const next = { ...existing };
  for (const [id, value] of Object.entries(incoming)) next[id] = Object.hasOwn(next, id) ? conflict(next[id], value) : value;
  return next;
}
/** Import the old catalog without flattening host envelopes or discarding conflicts. */
export function mergeThreadProjectCatalog(existing: unknown, incoming: ObjectValue): unknown {
  if (!Object.keys(incoming).length) return existing === undefined ? {} : existing;
  if (object(existing) && existing.$codexYardThreadProjects === 1 && Object.hasOwn(existing, 'legacy') && object(existing.hosts)) {
    return { ...existing, legacy: mergeLegacy(existing.legacy, incoming) };
  }
  return mergeLegacy(existing, record(incoming));
}
