export interface SettingsLocation { pathname: string; search: string; hash: string; state: unknown }
export interface SettingsRoute extends SettingsLocation { section: string; hostId: string; baseHost: string; path: string; redirect: string | null }

const normalizeSearch = (search: string) => search && !search.startsWith('?') ? `?${search}` : search;
const pluginPath = /^\/settings\/plugins-settings\/hosts\/([^/]+)\/plugins\/([^/]+)\/?$/;
const pluginParams = ['pluginName', 'marketplacePath', 'remoteMarketplaceName', 'directory'];
export function pluginRoute(pathname: string): { hostId: string; pluginId: string } | null {
  const match = pluginPath.exec(pathname);
  if (!match) return null;
  try {
    const hostId = decodeURIComponent(match[1]), pluginId = decodeURIComponent(match[2]);
    return hostId && pluginId ? { hostId, pluginId } : null;
  } catch { return null; }
}
export function readSettingsRoute(location: SettingsLocation, fallbackHost: string): SettingsRoute {
  const { pathname, hash, state } = location;
  const search = normalizeSearch(location.search);
  const params = new URLSearchParams(search);
  const baseHost = fallbackHost || 'local';
  const hostId = pluginRoute(pathname)?.hostId || params.get('hostId') || params.get('host') || baseHost;
  const match = /^\/settings(?:\/(.*?))?\/?$/.exec(pathname);
  let slug = match?.[1] || 'general';
  try { slug = decodeURIComponent(slug); } catch { /* Keep malformed paths visible as unknown routes. */ }
  if (slug === 'general' && params.get('initialRoute') === '/settings/agent') slug = 'configuration';
  const section = slug === 'general' ? 'general-settings' : slug.split('/')[0] || 'general-settings';
  const redirect = match && !match[1] ? `/settings/general${search}${hash}` : null;
  return { pathname, search, hash, state, section, hostId, baseHost, path: pathname + search + hash, redirect };
}
export function sectionPath(section: string, current: SettingsRoute): string {
  const params = new URLSearchParams(current.search);
  params.delete('initialRoute');
  if (section === 'configuration') params.set('initialRoute', '/settings/agent');
  if (section !== current.section) {
    params.delete('tab');
    if (current.section === 'plugins-settings') for (const key of pluginParams) params.delete(key);
    if (pluginRoute(current.pathname)) {
      params.delete('host');
      if (current.hostId === current.baseHost) params.delete('hostId'); else params.set('hostId', current.hostId);
    }
  }
  const search = params.toString();
  const path = section === 'general-settings' || section === 'configuration' ? 'general' : section.split('/').map(encodeURIComponent).join('/');
  return `/settings/${path}${search ? `?${search}` : ''}`;
}
export function hostPath(hostId: string, current: SettingsRoute): string {
  const params = new URLSearchParams(current.search);
  params.delete('host');
  if (hostId === current.baseHost) params.delete('hostId'); else params.set('hostId', hostId);
  const isPluginDetail = pluginRoute(current.pathname) !== null;
  if (isPluginDetail) for (const key of pluginParams) if (key !== 'directory') params.delete(key);
  const search = params.toString();
  return (isPluginDetail ? '/settings/plugins-settings' : current.pathname) + (search ? `?${search}` : '') + current.hash;
}
