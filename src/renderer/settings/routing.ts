export interface SettingsLocation { pathname: string; search: string }
export interface SettingsRoute extends SettingsLocation { section: string; hostId: string; path: string; redirect: string | null }

const normalizeSearch = (search: string) => search && !search.startsWith('?') ? `?${search}` : search;
export function readSettingsRoute(location: SettingsLocation | undefined, fallbackSection: string | undefined, fallbackHost: string): SettingsRoute {
  const fallback = fallbackSection?.replace(/^\/+|\/+$/g, '').replace(/^settings\//, '') || 'general';
  const pathname = location?.pathname ?? `/settings/${fallback}`;
  const search = normalizeSearch(location?.search ?? '');
  const params = new URLSearchParams(search);
  const hostId = params.get('hostId') || params.get('host') || fallbackHost || 'local';
  const match = /^\/settings(?:\/(.*?))?\/?$/.exec(pathname);
  let slug = match?.[1] || 'general';
  try { slug = decodeURIComponent(slug); } catch { /* Keep malformed paths visible as unknown routes. */ }
  const section = slug === 'general' ? 'general-settings' : slug.split('/')[0] || 'general-settings';
  const redirect = match && !match[1] ? `/settings/general${search}` : null;
  return { pathname, search, section, hostId, path: pathname + search, redirect };
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
  if (hostId === 'local') params.delete('hostId'); else params.set('hostId', hostId);
  const search = params.toString();
  return current.pathname + (search ? `?${search}` : '');
}
