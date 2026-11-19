import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { rendererRoot } from '../lib/app-resources.ts';
import { startupApplicationFile } from '../src/native/renderer-assets.ts';

const input = join(rendererRoot, 'assets', startupApplicationFile);
const source = await readFile(input, 'utf8');
// First-execution call paths identified in browser traces of the pinned home
// startup. Keep the calls and order; a step may still initialize its own tree.
const names = new Set([
  'CRu', 'Jxs', 'Kxs', 'ZXo', 'Vxs', 'UL', 'xLu', 'uLu', 'yOl', 'iOl', 'Gwl',
  'Pk', 'WJo', 'VJo', 'e2o', 'nwl', 'inr', 'GX', 'a0o', 'rvl', 'rC',
  'Hjn', 'Oer', 'RL', '$1o', '$gl', 'rvc',
]);
const ast = ts.createSourceFile(input, source, ts.ScriptTarget.ESNext, false, ts.ScriptKind.JS);
const generated: string[] = [];
const unwrap = (expression: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(expression) ? unwrap(expression.expression) : expression;
function expressions(expression: ts.Expression): ts.Expression[] {
  const node = unwrap(expression);
  return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken
    ? [...expressions(node.left), ...expressions(node.right)] : [expression];
}
for (const declaration of ast.statements) {
  if (!ts.isFunctionDeclaration(declaration) || !declaration.name || !names.has(declaration.name.text)) continue;
  const name = declaration.name.text;
  assert.equal(declaration.parameters.length, 0, name);
  const statements = declaration.body?.statements;
  assert.ok(statements?.length === 1 && ts.isReturnStatement(statements[0]!) && statements[0].expression, name);
  const invocation = unwrap(statements[0].expression);
  assert.ok(ts.isCallExpression(invocation) && invocation.arguments.length === 0, name);
  const assignment = unwrap(invocation.expression);
  assert.ok(ts.isBinaryExpression(assignment) && assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(assignment.left) && assignment.left.text === name, name);
  const wrapper = unwrap(assignment.right);
  assert.ok(ts.isCallExpression(wrapper) && ts.isIdentifier(wrapper.expression) && wrapper.expression.text === 't' && wrapper.arguments.length === 1, name);
  const body = unwrap(wrapper.arguments[0]!);
  assert.ok(ts.isArrowFunction(body) && body.parameters.length === 0 && ts.isBlock(body.body), name);
  const steps = body.body.statements.flatMap(statement => {
    if (!ts.isExpressionStatement(statement)) return [statement.getText(ast)];
    return expressions(statement.expression).map(expression => {
      const flat = unwrap(expression);
      if (ts.isCallExpression(flat) && ts.isIdentifier(flat.expression) && !flat.arguments.length && names.has(flat.expression.text)) {
        return `await yardStage_${flat.expression.text}();`;
      }
      return `(${expression.getText(ast)}); if (performance.now() > yardStageDeadline) await yardStageYield();`;
    });
  });
  generated.push(`const yardUnstaged_${name} = ${name};
async function yardStage_${name}() {
  if (${name} !== yardUnstaged_${name}) { ${name}(); return; }
  ${name} = () => {};
  ${steps.join('\n')}
}`);
}
assert.equal(generated.length, names.size);
assert.equal(source.split('CRu as Ag,').length, 2);
const additions = `
let yardStageDeadline = 0;
let yardStageNeedsPaint = false;
const yardStageOnInput = event => {
  if (event.target?.id === "pending-yard-home-input") yardStageNeedsPaint = true;
};
async function yardStageYield() {
  if (globalThis.scheduler?.yield) await globalThis.scheduler.yield();
  else await new Promise(resolve => setTimeout(resolve, 0));
  if (yardStageNeedsPaint && document.visibilityState === "visible") {
    yardStageNeedsPaint = false;
    await new Promise(resolve => {
      const limit = setTimeout(resolve, 50);
      requestAnimationFrame(() => setTimeout(() => { clearTimeout(limit); resolve(); }, 0));
    });
  }
  yardStageDeadline = performance.now() + 12;
}
${generated.join('\n')}
let yardStartupPromise;
function yardStagedStartup() {
  if (yardStartupPromise) return yardStartupPromise;
  if (!document.querySelector("#yard-startup #pending-yard-home-input[data-yard-active=true]")) return CRu();
  yardStartupPromise = (async () => {
    window.addEventListener("input", yardStageOnInput, true);
    try {
      await yardStageYield();
      await yardStage_CRu();
    } finally {
      window.removeEventListener("input", yardStageOnInput, true);
    }
  })();
  return yardStartupPromise;
}
`;
const target = fileURLToPath(new URL('../.local/' + startupApplicationFile, import.meta.url));
const staged = source.replace('CRu as Ag,', 'yardStagedStartup as Ag,') + additions;
const temporary = target + '.tmp.js';
await writeFile(temporary, staged);
execFileSync(process.execPath, ['--check', temporary], { stdio: 'inherit' });
await rename(temporary, target);
