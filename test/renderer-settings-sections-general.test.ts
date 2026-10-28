import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { rendererRoot } from '../lib/app-resources.ts';
import type { GeneralSettingsDependencies, GeneralSettingsRows, WindowsShellService } from '../src/renderer/settings/sections/general.tsx';
import type { SettingsGroup } from '../src/renderer/settings/sections/section-types.ts';

const source = await readFile(new URL('../src/renderer/settings/sections/general.tsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'tsx', format: 'esm', jsx: 'transform' });
const generalModule = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as typeof import('../src/renderer/settings/sections/general.tsx');
const { createGeneralSettingsComponents } = generalModule;
const pinned = await readFile(rendererRoot + '/assets/general-settings-8997e171b11a.js', 'utf8');
function upstream(start: string, end: string): string {
  const first = pinned.indexOf(start);
  const last = pinned.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `${start} / ${end}`);
  assert.equal(pinned.indexOf(start, first + start.length), -1, `unique ${start}`);
  return pinned.slice(first, last);
}

const compiledFunctions = [
  upstream('function Js(){', 'function Ys(){'),
  upstream('function Ys(){', 'function Xs(){'),
  upstream('function Xs(){', 'function Zs(){'),
  upstream('function Zs(){', 'function Qs(){'),
].join('');

interface Environment {
  any: boolean;
  local: boolean;
  workLocal: boolean;
  popout: boolean;
  suggestions: boolean;
  importFlag: boolean;
  importDismissed: boolean | null;
  windowsShell?: WindowsShellService;
}

function harness(environment: Environment) {
  const queries: string[] = [];
  const leaf = (name: string) => (props: {
    hostId?: string;
    appName?: string;
    withComposerGroup?: boolean;
    service?: WindowsShellService;
  }) => React.createElement('i', {
    'data-row': name,
    'data-host': props.hostId,
    'data-app': props.appName,
    'data-group': props.withComposerGroup == null ? undefined : String(props.withComposerGroup),
    'data-service': props.service === environment.windowsShell && props.service != null ? 'original' : undefined,
  });
  const rows: GeneralSettingsRows = {
    AccessSettings: leaf('access'), FullAccessSettings: leaf('full-access'),
    ProjectlessWorkspace: leaf('projectless'), DefaultOpenTarget: leaf('open-target'),
    AgentEnvironment: leaf('agent-environment'), TerminalShell: leaf('terminal-shell'),
    Language: leaf('language'), MenuBar: leaf('menu-bar'), CloseConfirmation: leaf('close-confirmation'),
    AdditionalPreference: leaf('additional'), WindowsStartup: leaf('windows-startup'),
    BottomPanelControl: leaf('bottom-panel'), TerminalLocation: leaf('terminal-location'),
    PreventSleep: leaf('prevent-sleep'), AutoArchive: leaf('archive'), ChatHistoryCompression: leaf('compression'),
    ServiceTier: leaf('service-tier'), AmbientSuggestions: leaf('suggestions'), ImportSettings: leaf('import'),
    OpenSourceLicenses: leaf('licenses'), Plugins: leaf('plugins'), DesktopBeta: leaf('beta'), InAppUpdates: leaf('updates'),
    MessagePredictions: leaf('predictions'), EducationalTips: leaf('tips'), LiteralText: leaf('literal'),
    ContextUsage: leaf('context'), EnterBehavior: leaf('enter'), FollowUpBehavior: leaf('follow-up'),
    PopoutWindow: leaf('popout'), Notifications: leaf('notifications'),
  };
  const Group = Object.assign(
    ({ children, id }: React.PropsWithChildren<{ id?: string }>) => React.createElement('section', { id }, children),
    {
      Header: ({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) => React.createElement('header', null, title, actions),
      Content: ({ children, className }: React.PropsWithChildren<{ className?: string }>) => React.createElement('article', { className }, children),
    },
  ) as SettingsGroup;
  const Rows = ({ children }: React.PropsWithChildren) => React.createElement('div', null, children);
  const FormattedMessage = ({ defaultMessage }: { defaultMessage: string }) => React.createElement('strong', null, defaultMessage);
  const Page: GeneralSettingsDependencies['Page'] = ({ title, children }) => React.createElement('main', null, title, children);
  const PageTitle: GeneralSettingsDependencies['PageTitle'] = ({ slug }) => React.createElement('h1', null, slug);
  const ToysBoundary: GeneralSettingsDependencies['ToysBoundary'] = ({ name, children }) => React.createElement('aside', { 'data-boundary': name }, children);
  const Toys = leaf('toys');
  const messages = {
    composerGroupTitle: { id: 'composer', defaultMessage: 'Composer', description: 'Composer' },
    notifications: { id: 'notifications', defaultMessage: 'Notifications', description: 'Notifications' },
  };
  const flag = (key: string) => {
    queries.push(key);
    return key === '1372061905' ? environment.popout : key === '2425897452' ? environment.suggestions : environment.importFlag;
  };
  const deps: GeneralSettingsDependencies = {
    Group, Rows, FormattedMessage, Page, PageTitle, ToysBoundary, Toys, rows,
    composerGroupTitle: messages.composerGroupTitle, notificationsTitle: messages.notifications, appName: 'Codex',
    getWindowsShell: () => environment.windowsShell, useAnySettingsAccess: () => environment.any,
    useLocalAccess: () => environment.local, useLocalOrWorkLocalAccess: () => environment.workLocal,
    useHostId: () => 'ssh:test', useFeatureFlag: flag, useImportFeatureFlag: () => flag('import-flag'),
    useImportDismissed: () => environment.importDismissed,
  };
  const bindings = {
    Q: { c: (length: number) => Array(length).fill(Symbol.for('react.memo_cache_sentinel')) }, $: jsxRuntime,
    L: (atom: string) => ({ any: environment.any, local: environment.local, workLocal: environment.workLocal,
      host: 'ssh:test', dismissed: environment.importDismissed })[atom],
    Qr: 'any', Dr: 'host', Vr: 'local', mr: 'workLocal', kn: 'dismissed', zi: 'import-flag', Yn: flag,
    U: Group, rt: Rows, M: FormattedMessage, W: messages, lr: PageTitle, dr: Page, Mn: ToysBoundary, zo: Toys,
    _: { windowsShell: environment.windowsShell }, Pt: 'Codex',
    To: rows.AccessSettings, vo: rows.FullAccessSettings, Ts: rows.ProjectlessWorkspace, lc: rows.DefaultOpenTarget,
    pc: rows.AgentEnvironment, fc: rows.TerminalShell, gc: rows.Language, cc: rows.MenuBar,
    ls: rows.CloseConfirmation, Mo: rows.AdditionalPreference, sc: rows.WindowsStartup,
    Cc: rows.BottomPanelControl, wc: rows.TerminalLocation, Fc: rows.PreventSleep, is: rows.AutoArchive,
    js: rows.ChatHistoryCompression, Hs: rows.ServiceTier, Ko: rows.AmbientSuggestions, hs: rows.ImportSettings,
    Qs: rows.OpenSourceLicenses, Xi: rows.Plugins, $s: rows.DesktopBeta, ec: rows.InAppUpdates,
    aa: rows.MessagePredictions, $i: rows.EducationalTips, ac: rows.LiteralText, Oc: rows.ContextUsage,
    Pc: rows.EnterBehavior, Dc: rows.FollowUpBehavior, ic: rows.PopoutWindow, Ki: rows.Notifications,
  };
  const original = new Function(...Object.keys(bindings), `${compiledFunctions}; return { Js, Ys, Xs, Zs };`)
    (...Object.values(bindings)) as { Js: React.ComponentType };
  const recovered = createGeneralSettingsComponents(React, deps);
  const render = (component: React.ComponentType) => {
    queries.length = 0;
    const html = renderToStaticMarkup(React.createElement(component));
    return { html, queries: [...queries] };
  };
  return { original: original.Js, recovered: recovered.GeneralSettings, render };
}

test('General arrangements match the pinned capability, feature and host branches', () => {
  const windowsShell: WindowsShellService = { openStartupSettings: async () => {}, getStartupStatus: async () => true };
  for (const any of [false, true]) for (const local of [false, true]) for (const workLocal of [false, true])
    for (const popout of [false, true]) for (const suggestions of [false, true])
      for (const importFlag of [false, true]) for (const importDismissed of [false, true, null]) {
        const fixture = harness({ any, local, workLocal, popout, suggestions, importFlag, importDismissed, windowsShell });
        const actual = fixture.render(fixture.recovered);
        assert.deepEqual(actual, fixture.render(fixture.original));
        assert.match(actual.html, /data-row="windows-startup" data-service="original"/);
        assert.match(actual.html, /data-row="tips" data-group="false"/);
        if (!any) {
          assert.match(actual.html, /data-row="menu-bar" data-app="ChatGPT"/);
          assert.doesNotMatch(actual.html, /data-row="notifications"/);
          assert.deepEqual(actual.queries, []);
        } else {
          assert.match(actual.html, /data-row="plugins" data-host="ssh:test"/);
          assert.equal(actual.html.includes('data-row="compression" data-host="ssh:test"'), workLocal);
          assert.equal(actual.html.includes('data-row="popout"'), local && popout);
          assert.equal(actual.html.includes('data-row="suggestions"'), workLocal && suggestions);
          assert.equal(actual.html.includes('data-row="import"'), workLocal && !importFlag && importDismissed !== true);
          assert.deepEqual(actual.queries, ['1372061905', '2425897452', 'import-flag']);
        }
      }
  const fixture = harness({ any: true, local: true, workLocal: true, popout: true, suggestions: true, importFlag: false, importDismissed: false });
  assert.doesNotMatch(fixture.render(fixture.recovered).html, /data-row="windows-startup"/);
});
