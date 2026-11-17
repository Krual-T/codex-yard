/** Reuse General's existing Notifications section and pinned Settings controls
 * for this browser's Web Push preferences. */
export function adaptNotificationSettings(path: string, content: Buffer): Buffer {
  if (path !== '/assets/notifications-settings-ccf8e20eaab9.js') return content;
  const source = content.toString('utf8');
  const start = source.indexOf('function lt(){');
  const end = source.indexOf('async function ut(){', start);
  if (start < 0 || end < 0 || source.split('function lt(){').length !== 2) {
    throw new Error('通知设置与固定界面版本不匹配：' + path);
  }
  return Buffer.from(source.slice(0, start) + 'function lt(){return window.workbenchNotificationSettings({Row:R,Toggle:N,Button:t})}' + source.slice(end));
}
