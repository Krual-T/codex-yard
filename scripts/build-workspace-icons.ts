import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import ts from 'typescript';
import { rendererRoot } from '../lib/app-resources.ts';
import { rendererAssets, workspaceIconNames } from '../src/native/renderer-assets.ts';

type IconShape = [tag: string, attributes: Record<string, string>, children?: IconShape[]];
const tags = new Set(['path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
const attributes = new Set([
  'd', 'fill', 'fill-rule', 'fill-opacity', 'clip-rule', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity', 'transform',
  'points', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height',
]);

function iconShape(node: ts.JsxChild): IconShape {
  assert.ok(ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node), 'Expected static icon geometry');
  const element = ts.isJsxElement(node) ? node.openingElement : node;
  assert.ok(ts.isIdentifier(element.tagName) && tags.has(element.tagName.text), 'Unexpected icon primitive');
  const props = Object.fromEntries(element.attributes.properties.map(attribute => {
    assert.ok(ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && attributes.has(attribute.name.text),
      'Unexpected icon attribute');
    assert.ok(attribute.initializer && ts.isStringLiteral(attribute.initializer), 'Icon attributes must be literal');
    return [attribute.name.text.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()), attribute.initializer.text];
  }));
  return ts.isJsxElement(node)
    ? [element.tagName.text, props, node.children.filter(child => !ts.isJsxText(child) || child.text.trim()).map(iconShape)]
    : [element.tagName.text, props];
}

function iconShapes(body: string) {
  const file = ts.createSourceFile('icon.tsx', `<svg>${body}</svg>`, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const node = file.statements[0];
  assert.ok(file.statements.length === 1 && node && ts.isExpressionStatement(node) && ts.isJsxElement(node.expression),
    'Expected a static SVG body');
  return node.expression.children.filter(child => !ts.isJsxText(child) || child.text.trim()).map(iconShape);
}

function property(node: ts.Node | undefined, name: string) {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  const value = node.properties.find((prop): prop is ts.PropertyAssignment =>
    ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === name);
  return value?.initializer;
}

function literal(node: ts.Node | undefined) {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

export async function readPinnedWorkspaceIcons() {
  const filename = join(rendererRoot, 'assets', basename(rendererAssets.shared));
  const shared = await readFile(filename, 'utf8');
  const file = ts.createSourceFile(filename, shared, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const pending = new Map<string, string[]>();
  for (const [key, name] of Object.entries(workspaceIconNames)) {
    pending.set(name, [...pending.get(name) ?? [], key]);
  }
  const found: Record<string, { viewBox: string; shapes: IconShape[] }> = {};
  function visit(node: ts.Node): true | undefined {
    if (ts.isObjectLiteralExpression(node)) {
      const name = literal(property(node, 'name'));
      const keys = name && pending.get(name);
      if (keys && name) {
        const viewBox = literal(property(property(node, 'canvas'), 'viewBox'));
        const body = literal(property(node, 'body'));
        assert.ok(body && viewBox, 'Missing vector geometry for ' + name);
        const geometry = { viewBox, shapes: iconShapes(body) };
        for (const key of keys) found[key] = geometry;
        pending.delete(name);
        if (!pending.size) return true;
      }
    }
    return ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(pending.size, 0, 'Missing pinned icons: ' + [...pending.keys()].join(', '));
  // Plane is a legacy inline vector; this pinned renderer has no catalog entry.
  const application = await readFile(join(rendererRoot, 'assets', basename(rendererAssets.application)), 'utf8');
  const plane = application.match(/d:`(M12\.731429 2\.982888H12\.142171[\d\sA-Za-z.,+-]+)`,fill:`currentColor`/);
  assert.ok(plane?.[1], 'Missing pinned project plane vector');
  found['project:plane'] = { viewBox: '0 0 16 16', shapes: [['path', { d: plane[1], fill: 'currentColor' }]] };
  found['picker:plane'] = found['project:plane'];
  const book = await readFile(join(rendererRoot, 'assets', basename(rendererAssets.bookOpen)), 'utf8');
  for (const [key, asset, path, viewBox] of [
    ['toolRead', book, /d:\x60(M16\.3965 5\.01128[^\x60]+)\x60/, '0 0 20 20'],
    ['toolChevron', shared, /d:\x60(M7\.52925 3\.7793[^\x60]+)\x60/, '0 0 20 20'],
    ['questionChevron', shared, /d:\x60(M15\.2793 7\.71101[^\x60]+)\x60/, '0 0 20 21'],
  ] as const) {
    const d = asset.match(path)?.[1];
    assert.ok(d, 'Missing pinned tool vector: ' + key);
    found[key] = { viewBox, shapes: [['path', { d, fill: 'currentColor' }]] };
  }
  for (const [key, viewBox, path, evenodd] of [
    ['messageImage', '0 0 20 21', /d:\x60(M16\.0012 7\.78796[^\x60]+)\x60/, false],
    ['messageFile', '0 0 10 10', /d:\x60(M5\.62988 1\.12599[^\x60]+)\x60/, true],
  ] as const) {
    const d = shared.match(path)?.[1];
    assert.ok(d, 'Missing pinned message vector: ' + key);
    found[key] = { viewBox, shapes: [['path', { d, fill: 'currentColor',
      ...(evenodd ? { fillRule: 'evenodd', clipRule: 'evenodd' } : {}) }]] };
  }
  const waiting = application.match(/d:\x60(M6\.09967 11\.3164[^\x60]+)\x60[^]*?d:\x60(M17\.7335 13\.3301[^\x60]+)\x60[^]*?d:\x60(M7\.89752 3\.78207[^\x60]+)\x60[^]*?d:\x60(M17\.7335 5\.73011[^\x60]+)\x60/);
  assert.ok(waiting, 'Missing pinned waiting-for-input vector');
  found.toolWaiting = { viewBox: '0 0 21 21', shapes: waiting.slice(1).map((d, index) => ['path', { d, fill: 'currentColor',
    ...(index === 0 ? { fillRule: 'evenodd', clipRule: 'evenodd' } : {}) }]) };
  // Activity spinner is also an inline vector rather than a catalog entry.
  const spinner = shared.match(/opacity:\.3,d:\x60(M18 12C18 8\.68629[^`]+)\x60,fill:\x60currentColor\x60\}\),[^}]+d:\x60(M12 4C16\.4183[^`]+)\x60,fill:\x60currentColor\x60/);
  assert.ok(spinner?.[1] && spinner[2], 'Missing pinned activity spinner');
  found.runningSpinner = { viewBox: '0 0 24 24', shapes: [
    ['path', { d: spinner[1], fill: 'currentColor', opacity: '0.3' }],
    ['path', { d: spinner[2], fill: 'currentColor' }],
  ] };
  return found;
}

export async function readPinnedProjectEmojis() {
  const filename = join(rendererRoot, 'assets', basename(rendererAssets.symbols));
  const file = ts.createSourceFile(filename, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const categories = {
    smileys_people: 'Smileys and emotion', animals_nature: 'Animals and nature', food_drink: 'Food and drink',
    travel_places: 'Travel and places', activities: 'Activities', objects: 'Objects', symbols: 'Symbols', flags: 'Flags',
  };
  function array(node: ts.Node | undefined) {
    assert.ok(node && ts.isArrayLiteralExpression(node), 'Expected static emoji catalog data');
    return node.elements;
  }
  function visit(node: ts.Node): ts.ObjectLiteralExpression | undefined {
    if (ts.isObjectLiteralExpression(node) && Object.keys(categories).every(key => {
      const value = property(node, key);
      return value && ts.isArrayLiteralExpression(value);
    })) return node;
    return ts.forEachChild(node, visit);
  }
  const catalog = visit(file);
  assert.ok(catalog, 'Missing pinned emoji catalog');
  return Object.entries(categories).flatMap(([key, label]) => {
    const entries = array(property(catalog, key)).map(item => {
      const hex = literal(property(item, 'u'));
      const keywords = array(property(item, 'n')).map(literal);
      assert.ok(hex && /^[\da-f]+(?:-[\da-f]+)*$/i.test(hex) && keywords.length && keywords.every(Boolean), 'Unexpected emoji catalog record');
      return [String.fromCodePoint(...hex.split('-').map(value => Number.parseInt(value, 16))), keywords] as const;
    });
    if (key !== 'smileys_people') return [[label, entries]];
    const split = entries.findIndex(([emoji]) => emoji === '\u{1f44b}');
    assert.ok(split > 0, 'Missing People and body boundary');
    return [[label, entries.slice(0, split)], ['People and body', entries.slice(split)]];
  });
}
