import { copyFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { build } from 'esbuild';

// The copied functions are kept byte-for-byte here before esbuild formatting.
// Only the App's initialization calls and its I/O ports are replaced. Never run
// the renderer initialization or manufacture an AppScope in the Node host.
const root = resolve(process.argv[2] ?? 'vendor/codex-app/26.1013.40934/webview/assets');
const output = resolve('vendor/native-app-tools/26.1013.40934/portable-tools.mjs');
const executionPath = resolve(root, 'execution-1c8c4b717459.js');
const initialPath = resolve(root, 'app-initial-a68277f60b93.js');
const execution = await readFile(executionPath, 'utf8');
const initial = await readFile(initialPath, 'utf8');
const execAst = ts.createSourceFile(executionPath, execution, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const initialAst = ts.createSourceFile(initialPath, initial, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function functions(ast: ts.SourceFile) {
  return new Map(ast.statements.filter(ts.isFunctionDeclaration).flatMap(node => node.name ? [[node.name.text, node] as const] : []));
}
const execFunctions = functions(execAst), initialFunctions = functions(initialAst);

// Follow lexical bindings, including the assignments inside upstream's lazy
// initializers. Copy only dependencies of the selected pure functions; copying
// an entire initializer would also start unrelated renderer services.
interface SourceSlice {
  ast: ts.SourceFile; checker: ts.TypeChecker;
  bindings: Map<ts.Symbol, ts.Declaration>;
  assignments: Map<ts.Symbol, ts.Expression>;
  enumInitializers: Map<ts.Symbol, ts.Expression>;
  exports: Map<string, string>; selected: Set<ts.Symbol>;
  declarations: string[]; imports: Map<string, Set<string>>;
}
const slices = new Map<string, SourceSlice>();
async function sourceSlice(path: string): Promise<SourceSlice> {
  const cached = slices.get(path);
  if (cached) return cached;
  const ast = path === initialPath ? initialAst : ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const host = ts.createCompilerHost({ noResolve: true, noLib: true, allowJs: true });
  host.getSourceFile = name => name === path ? ast : undefined;
  const checker = ts.createProgram([path], { noResolve: true, noLib: true, allowJs: true }, host).getTypeChecker();
  const result: SourceSlice = { ast, checker, bindings: new Map(), assignments: new Map(), enumInitializers: new Map(), exports: new Map(),
    selected: new Set(), declarations: [], imports: new Map() };
  slices.set(path, result);
  function bind(node: ts.Declaration, name: ts.Identifier) {
    const symbol = checker.getSymbolAtLocation(name);
    if (symbol) result.bindings.set(symbol, node);
  }
  for (const statement of ast.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) bind(statement, statement.name);
    if (ts.isVariableStatement(statement)) for (const node of statement.declarationList.declarations) if (ts.isIdentifier(node.name)) bind(node, node.name);
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const node of statement.importClause.namedBindings.elements) bind(node, node.name);
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const entry of statement.exportClause.elements) result.exports.set(entry.name.text, (entry.propertyName ?? entry.name).text);
    }
  }
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isParenthesizedExpression(node.expression) && ts.isFunctionExpression(node.expression.expression)) {
      for (const argument of node.arguments) if (ts.isBinaryExpression(argument) && ts.isIdentifier(argument.left) && argument.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken) {
        const symbol = checker.getSymbolAtLocation(argument.left);
        if (symbol && result.bindings.has(symbol)) result.enumInitializers.set(symbol, node);
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
      const symbol = checker.getSymbolAtLocation(node.left);
      if (symbol && result.bindings.has(symbol) && !result.assignments.has(symbol)) result.assignments.set(symbol, node.right);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}
async function select(path: string, name: string, exported = false): Promise<void> {
  const part = await sourceSlice(path);
  const local = exported ? part.exports.get(name) : name;
  const entry = [...part.bindings].find(([, declaration]) => 'name' in declaration && declaration.name && ts.isIdentifier(declaration.name as ts.Node) && (declaration.name as ts.Identifier).text === local);
  if (!entry) throw new Error(`Missing upstream binding: ${path} ${name}`);
  const [symbol, declaration] = entry;
  if (part.selected.has(symbol)) return;
  part.selected.add(symbol);
  if (path.endsWith('/app-shared-61271c39e3c5.js') && local === 'O_') {
    // The upstream browser build decodes named HTML entities via an <i>.
    // Replace that one platform port with the standard Node entity decoder.
    part.imports.set('entities', new Set(['decodeHTMLStrict as decodeNativeEntity']));
    part.declarations.push('function O_(e){let t=`&`+e+`;`,n=decodeNativeEntity(t);return n.charCodeAt(n.length-1)===59&&e!==`semi`?!1:n!==t&&n}');
    return;
  }
  if (ts.isImportSpecifier(declaration)) {
    const importDeclaration = declaration.parent.parent.parent;
    if (!ts.isImportDeclaration(importDeclaration) || !ts.isStringLiteral(importDeclaration.moduleSpecifier)) throw new Error('Unexpected import');
    const specifier = importDeclaration.moduleSpecifier.text;
    const imports = part.imports.get(specifier) ?? new Set<string>();
    imports.add(declaration.getText(part.ast)); part.imports.set(specifier, imports);
    await select(resolve(dirname(path), specifier), (declaration.propertyName ?? declaration.name).text, true);
    return;
  }
  const enumInitializer = part.enumInitializers.get(symbol);
  const expression = ts.isVariableDeclaration(declaration) ? declaration.initializer ?? enumInitializer ?? part.assignments.get(symbol) : declaration;
  if (!expression) { part.declarations.push(`var ${local};`); return; }
  const dependencies = new Set<ts.Symbol>();
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node)) {
      const dependency = part.checker.getSymbolAtLocation(node);
      if (dependency && dependency !== symbol && part.bindings.has(dependency)) dependencies.add(dependency);
    }
    ts.forEachChild(node, visit);
  }
  visit(expression);
  for (const dependency of dependencies) {
    const node = part.bindings.get(dependency)!;
    if ('name' in node && node.name && ts.isIdentifier(node.name as ts.Node)) await select(path, (node.name as ts.Identifier).text);
  }
  part.declarations.push(ts.isVariableDeclaration(declaration) ? enumInitializer ? `var ${local};${expression.getText(part.ast)};` : `var ${local}=${expression.getText(part.ast)};` : declaration.getText(part.ast));
}
function original(name: string, nodes = execFunctions, ast = execAst) {
  const node = nodes.get(name);
  if (!node) throw new Error(`Upstream function missing: ${name}`);
  return node.getText(ast);
}
function assignments(name: string, nodes = execFunctions, ast = execAst) {
  const body = nodes.get(name);
  if (!body) throw new Error(`Upstream initializer missing: ${name}`);
  const values: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isArrowFunction(node)) {
      if (!ts.isBlock(node.body)) throw new Error('Expected initializer block');
      for (const statement of node.body.statements) {
        if (!ts.isExpressionStatement(statement)) throw new Error('Unexpected upstream initializer statement');
        function comma(expression: ts.Expression) {
          if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
            comma(expression.left); comma(expression.right);
          } else if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(expression.left)) {
            values.push(`var ${expression.getText(ast)};`);
          } else if (!ts.isCallExpression(expression)) throw new Error('Unexpected upstream initializer expression');
        }
        comma(statement.expression);
      }
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  if (!values.length) throw new Error(`Empty upstream initializer: ${name}`);
  return values.join('\n');
}
const plainFunctions = ['Pf', 'Ff', 'If', 'Lf', 'Rf', 'zf', 'Bf', 'Vf', 'tp', 'np', 'rp', 'ip', 'ap', 'op', 'cp', 'Z', 'Op', 'kp'];
// These helpers have no App I/O. Their original definitions, along with the
// Markdown libraries they use, are bundled from the preserved upstream files.
const input = `
import {n as e,o as t} from './rolldown-runtime-2d059c5e81f4.js';
import {SLt as S,lLt as be,xLt as I,uLt as Le,rIt as P,XIt as O,wIt as He,mIt as we,
  uIt as c,Fpt as u,Lpt as b,zNt as We,Svt as w,agt as se} from './app-shared-61271c39e3c5.js';
import {Myr as or,mSr as Cs,Pyr as Vr,qSr as tc,Oyr as formatAssistantMessage,nativeParentThread,delegationTurnInput,
  Yxr as ma,kgr as q} from './app-initial-a68277f60b93.js';
import {o_t as Oe} from './app-shared-61271c39e3c5.js';
const iu=I,K=S,Pl=c,ec=be;
${assignments('_7l', initialFunctions, initialAst)}
const _n=e7l,vi=Z5l;
${assignments('Yp')}
${assignments('Xf')}
const pt=J5l,lp=16777216,up={timeoutMs:15000};
${plainFunctions.map(name => original(name)).join('\n')}
export const catalog=[i7l,a7l,s7l,c7l,l7l,u7l,d7l,o7l,p7l,m7l,h7l,g7l];
export const schemas={list_projects:Bp,create_thread:Rp,fork_thread:zp,list_threads:Vp,list_archived_threads:Hp,
 read_thread:Up,wait_threads:pt,send_message_to_thread:Wp,set_thread_pinned:Gp,set_thread_archived:Kp,
 set_thread_title:qp,set_thread_read_state:Jp};
export {Jf as ThreadWaiter,cp as readHistory,Z as success,q as failure,Op as invalidArguments,kp as validateModel,
 formatAssistantMessage,nativeParentThread,delegationTurnInput};
`;
const initialSlice = await sourceSlice(initialPath);
initialSlice.exports.set('nativeParentThread', 'GDn');
initialSlice.exports.set('delegationTurnInput', 'iWn');
await mkdir(dirname(output), { recursive: true });
const inputAst = ts.createSourceFile('entry.js', input, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
for (const node of inputAst.statements) if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) &&
  node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
  for (const specifier of node.importClause.namedBindings.elements) await select(resolve(root, node.moduleSpecifier.text), (specifier.propertyName ?? specifier.name).text, true);
}
const subset = new Map([...slices].map(([path, part]) => [path,
  [...part.imports].map(([specifier, names]) => `import{${[...names].join(',')}}from ${JSON.stringify(specifier)};`).join('\n') + '\n' +
  part.declarations.join('\n') + '\nexport{' + [...part.exports].filter(([, name]) => part.declarations.some(value => value.startsWith('var ' + name + '=') || value.startsWith('function ' + name + '(') || value.startsWith('async function ' + name + '(')))
    .map(([exported, local]) => `${local} as ${exported}`).join(',') + '};',
]));
await build({ stdin: { contents: input, resolveDir: root, sourcefile: 'portable-native-tool-entry.js' },
  outfile: output, bundle: true, format: 'esm', platform: 'node', target: 'node24', treeShaking: true,
  banner: { js: '// Derived from Codex App 26.1013.40934. Upstream copyrights and terms apply.\n// Generated by scripts/extract-native-tools.ts; do not edit generated code.\nglobalThis.__zod_globalConfig ??= {};' },
  legalComments: 'eof', write: false,
  plugins: [{ name: 'selected-upstream-bindings', setup(context) {
    context.onLoad({ filter: /\.js$/ }, args => {
      if (args.path.includes('/node_modules/')) return undefined;
      const contents = subset.get(args.path);
      if (!contents) throw new Error(`Unexpected dependency outside copied native tool closure: ${args.path}`);
      return { contents, resolveDir: dirname(args.path), loader: 'js' };
    });
  } }],
}).then(async result => {
  const content = result.outputFiles?.[0]?.text;
  if (!content) throw new Error('Native tool extraction produced no output');
  await writeFile(output, content);
});
// Preserve the original transport next to the kernel, independently of the UI snapshot.
await copyFile(resolve(root, '../../codex-app-tools/server.mjs'), resolve(dirname(output), 'server.mjs'));
console.log('Extracted original native tool catalog, schemas, history projection, wait kernel and MCP adapter.');
