// Exercise the copied original file runtime and template generator. No account
// or connector is used. Set YARD_ARTIFACT_RUNTIME_MANIFEST for a nondefault root.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot } from '../lib/app-resources.ts';

const execute = promisify(execFile);
const root = await mkdtemp('/tmp/yard-file-runtime-');
const checks: string[] = [];
const report: Record<string, unknown> = { checks };
try {
  if (process.env.AGENTS_TEST_MASKED_APP) {
    assert.deepEqual(await readdir(process.env.AGENTS_TEST_MASKED_APP), []);
    report.desktopInstallationUnavailable = true;
  }
  const { stdout } = await execute(process.execPath, [join(projectRoot, 'plugins/documents/runtime.ts')]);
  const runtime = JSON.parse(stdout) as Record<string, string>;
  report.runtimeVersion = runtime.version;
  const env = { ...process.env, PATH: [runtime.overrideBinDir, process.env.PATH, runtime.fallbackBinDir].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'), CODEX_HOME: join(root, 'codex') };
  await execute(runtime.pythonPath, ['-c', `from docx import Document
from reportlab.pdfgen import canvas
from pypdf import PdfReader
from pathlib import Path
p=Path(${JSON.stringify(root)})
doc=Document();doc.add_heading('Yard standalone fixture',0);doc.add_paragraph('Original document runtime');doc.save(p/'document.docx')
c=canvas.Canvas(str(p/'fixture.pdf'));c.drawString(72,720,'Yard original PDF runtime');c.save()
assert 'Yard original PDF runtime' in PdfReader(str(p/'fixture.pdf')).pages[0].extract_text()
`], { env, timeout: 30000 });
  await execute(runtime.pythonPath, [join(projectRoot, 'plugins/documents/skills/documents/render_docx.py'), join(root, 'document.docx'), '--output_dir', join(root, 'document-render'), '--emit_pdf'], { env, timeout: 90000 });
  assert.ok((await readdir(join(root, 'document-render'))).some(name => name.endsWith('.png')));
  await execute(join(runtime.overrideBinDir, 'pdftoppm'), ['-png', '-singlefile', '-scale-to', '600', join(root, 'fixture.pdf'), join(root, 'pdf-preview')], { env, timeout: 30000 });
  checks.push('Copied Python, original document renderer, LibreOffice and Poppler create, read and render DOCX/PDF independently');
  const script = join(root, 'files.mjs');
  const entry = pathToFileURL(join(runtime.nodeModulesPath, '@oai/artifact-tool/dist/artifact_tool.mjs')).href;
  await writeFile(script, `import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Workbook,SpreadsheetFile,FileBlob,Presentation,PresentationFile} from ${JSON.stringify(entry)};
const root=${JSON.stringify(root)};
const wb=Workbook.create();const sheet=wb.worksheets.add('Fixture');sheet.getRange('A1:B1').values=[[6,7]];sheet.getRange('C1').formulas=[['=A1*B1']];wb.recalculate();assert.equal(sheet.getRange('C1').values[0][0],42);
await (await SpreadsheetFile.exportXlsx(wb)).save(root+'/fixture.xlsx');
await fs.writeFile(root+'/sheet.png',new Uint8Array(await (await wb.render({sheetName:'Fixture',range:'A1:C2',scale:1,format:'png'})).arrayBuffer()));
const read=await SpreadsheetFile.importXlsx(await FileBlob.load(root+'/fixture.xlsx'));assert.equal(read.worksheets.getItem('Fixture').getRange('C1').values[0][0],42);
const ppt=Presentation.create({slideSize:{width:1280,height:720}});const slide=ppt.slides.add();const title=slide.shapes.add({geometry:'textbox',position:{left:72,top:60,width:1000,height:100},fill:'none',line:{fill:'none',width:0}});title.text='Yard original runtime';title.text.style={typeface:'Arial',fontSize:40,color:'#142735'};
await (await PresentationFile.exportPptx(ppt)).save(root+'/fixture.pptx');await fs.writeFile(root+'/slide.png',new Uint8Array(await (await ppt.export({slide,format:'png',scale:1})).arrayBuffer()));
`);
  await execute(runtime.nodePath, [script], { env, timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
  checks.push('Original artifact-tool exports and reimports an XLSX formula with result 42, renders a sheet and exports/renders a PPTX');
  const generator = join(projectRoot, 'plugins/template-creator/skills/template-creator/scripts/create-template-skill.mjs');
  const arguments_ = ['--reference-path', join(root, 'document.docx'), '--preview-path', join(root, 'document-render/page-1.png'), '--display-name', 'Yard fixture', '--description', 'Standalone validation fixture', '--kind', 'document'];
  const created = JSON.parse((await execute(process.execPath, [generator, ...arguments_], { env })).stdout);
  report.template = created;
  const skillName = created.skillName;
  assert.equal(typeof skillName, 'string');
  const skillDir = join(env.CODEX_HOME, 'skills', skillName);
  assert.match(await readFile(join(skillDir, 'SKILL.md'), 'utf8'), /artifact-template/);
  assert.ok((await readFile(join(skillDir, 'artifact-template.json'), 'utf8')).includes('document'));
  assert.ok((await readFile(join(skillDir, 'agents/openai.yaml'), 'utf8')).includes('Yard fixture'));
  await execute(process.execPath, [generator, ...arguments_, '--mode', 'update', '--skill-name', skillName], { env });
  checks.push('Original template generator atomically creates and updates a template Skill, reference/preview assets, manifest and agent metadata in a disposable Codex home');
  report.ok = true;
} catch (cause) { report.ok = false; report.error = cause instanceof Error ? cause.stack : String(cause); process.exitCode = 1; }
finally { await rm(root, { recursive: true, force: true }); console.log(JSON.stringify(report, null, 2)); }
