export interface SettingsLocation { pathname: string; search: string; hash: string; state: unknown }
export interface SettingsRoute extends SettingsLocation { section: string; hostId: string; baseHost: string; path: string; redirect: string | null }

const normalizeSearch = (search: string) => search && !search.startsWith('?') ? `?${search}` : search;
export function readSettingsRoute(location: SettingsLocation, fallbackHost: string): SettingsRoute {
  const { pathname, hash, state } = location;
  const search = normalizeSearch(location.search);
  const params = new URLSearchParams(search);
  const baseHost = fallbackHost || 'local';
  const hostId = params.get('hostId') || params.get('host') || baseHost;
  const match = /^\/settings(?:\/(.*?))?\/?$/.exec(pathname);
  let slug = match?.[1] || 'general';
  try { slug = decodeURIComponent(slug); } catch { /* Keep malformed paths visible as unknown routes. */ }
  const section = slug === 'general' ? 'general-settings' : slug.split('/')[0] || 'general-settings';
  const redirect = match && !match[1] ? `/settings/general${search}${hash}` : null;
  return { pathname, search, hash, state, section, hostId, baseHost, path: pathname + search + hash, redirect };
}
export function sectionPath(section: string, current: SettingsRoute): string {
  const params = new URLSearchParams(current.search);
  if (section !== current.section) params.delete('tab');
  const search = params.toString();
  const path = section === 'general-settings' ? 'general' : section.split('/').map(encodeURIComponent).join('/');
  return `/settings/${path}${search ? `?${search}` : ''}`;
}
export function hostPath(hostId: string, current: SettingsRoute): string {
  const params = new URLSearchParams(current.search);
  params.delete('host');
  if (hostId === current.baseHost) params.delete('hostId'); else params.set('hostId', hostId);
  const search = params.toString();
  return current.pathname + (search ? `?${search}` : '') + current.hash;
}
