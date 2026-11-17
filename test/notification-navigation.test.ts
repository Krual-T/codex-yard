import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const origin = 'https://yard.test';

async function click(windows: object[], url = '/?initialRoute=%2Flocal%2Ftarget') {
  const handlers = new Map<string, (event: unknown) => void>(), opened: string[] = [];
  runInNewContext(await readFile(new URL('../.local/notification-worker.js', import.meta.url), 'utf8'), {
    location: { origin }, URL, MessageChannel, clearTimeout, setTimeout,
    addEventListener: (type: string, listener: (event: unknown) => void) => handlers.set(type, listener),
    clients: { matchAll: async () => windows, openWindow: async (url: string) => { opened.push(url); } },
  });
  let closed = false, work: Promise<void> | undefined;
  handlers.get('notificationclick')!({ notification: { data: { url }, close() { closed = true; } }, waitUntil(value: Promise<void>) { work = value; } });
  await work;
  assert.equal(closed, true);
  return opened;
}

test('a notification focuses an existing top-level Yard tab and sends its route without reloading it', async () => {
  const actions: string[] = [];
  const main = { url: origin + '/?initialRoute=%2Flocal%2Fprevious', frameType: 'top-level',
    postMessage(message: { type: string; url: string }, ports: MessagePort[]) {
      assert.equal(message.type, 'yard-notification-navigate');
      assert.equal(message.url, origin + '/?initialRoute=%2Flocal%2Ftarget');
      actions.push('message'); ports[0].postMessage(true);
    },
    async focus() { actions.push('focus'); }, async navigate() { actions.push('reload'); },
  };
  const unrelated = (url: string, frameType: string) => ({ ...main, url, frameType, postMessage() { assert.fail('Selected an unrelated client'); } });
  const opened = await click([
    unrelated(origin + '/?app=skybridge', 'nested'), unrelated(origin + '/avatar-overlay', 'nested'),
    unrelated(origin + '/', 'nested'), unrelated('https://other.test/', 'top-level'), main,
  ]);
  assert.deepEqual(actions, ['message', 'focus']);
  assert.deepEqual(opened, []);
});

test('a notification opens its target when no Yard tab is available and upgrades an old tab that cannot receive routes', async () => {
  assert.deepEqual(await click([]), [origin + '/?initialRoute=%2Flocal%2Ftarget']);
  const actions: string[] = [];
  const opened = await click([{ url: origin + '/', frameType: 'top-level', postMessage() {},
    async focus() { actions.push('focus'); }, async navigate(url: string) { actions.push(url); },
  }]);
  assert.deepEqual(opened, []);
  assert.deepEqual(actions, ['focus', origin + '/?initialRoute=%2Flocal%2Ftarget']);
  assert.deepEqual(await click([], 'https://other.test/'), []);
});

test('the browser queues a notification during startup and uses the native router for local, SSH and Scheduled routes', async () => {
  let receive: (event: any) => void = () => { throw new Error('Missing Service Worker listener'); };
  const published: any[] = [], acknowledgements: boolean[] = [];
  let savedAtoms: string | null = null;
  class Socket extends EventTarget { send() {} }
  const window: any = Object.assign(new EventTarget(), { postMessage: (value: unknown) => published.push(value),
    navigator: { serviceWorker: { addEventListener(_type: string, listener: typeof receive) { receive = listener; } } },
  });
  runInNewContext(await readFile(new URL('../.local/native-host.js', import.meta.url), 'utf8'), {
    window, Event, WebSocket: Socket, URL, URLSearchParams, location: { origin, href: origin + '/' },
    localStorage: { getItem: () => savedAtoms }, history: { replaceState() {} },
    setTimeout() {}, matchMedia: () => ({ matches: false }), performance: { timeOrigin: 0 },
  });
  const deliver = (url: string, sourceOrigin = origin) => receive({ origin: sourceOrigin,
    data: { type: 'yard-notification-navigate', url }, ports: [{ postMessage(value: boolean) { acknowledgements.push(value); } }],
  });
  deliver('/?initialRoute=' + encodeURIComponent('/local/target'));
  assert.equal(published.length, 0);
  assert.deepEqual(acknowledgements, [true]);
  await window.electronBridge.sendMessageFromView({ type: 'browser-sidebar-owner-sync', ownerRoutePath: '/' });
  for (const path of ['/remote-ssh-codex-managed%3Afixture/ssh-target', '/automations', '/']) {
    deliver('/?initialRoute=' + encodeURIComponent(path));
  }
  assert.deepEqual(published.map(message => message.path), ['/local/target', '/remote-ssh-codex-managed%3Afixture/ssh-target', '/automations', '/']);
  for (const url of ['https://other.test/', '/unrelated', '/?initialRoute=relative', '/?initialRoute=%2F%2Fother.test']) deliver(url);
  deliver('/', 'https://other.test');
  assert.equal(published.length, 4);
  assert.equal(acknowledgements.length, 4);
  savedAtoms = JSON.stringify({ 'client-thread-bindings-v1': { 'client-alias': 'daemon-thread' } });
  await window.electronBridge.sendMessageFromView({ type: 'browser-sidebar-owner-sync', ownerRoutePath: '/local/client-alias' });
  assert.equal(window.workbenchStartupSidebar.route(), '/local/daemon-thread', 'startup handoff uses the same resolved route as the URL');
});
