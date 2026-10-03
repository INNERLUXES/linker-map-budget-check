import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINDINGS, USAGE, VERSION, checkFile, csvCell, displayPath, fileError, main, mdCell, parseArgs, readBounded, toCsv, toJson, toMarkdown, toText } from '../src/index.js';
import { check, cli, firmware, gnuMap, inp, out, run } from './helpers.js';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFile(resolve(root, rel), 'utf8');

// Runs the tool on files of the repository, with the root of the repository as the base for relative paths.
async function inRoot(argv) {
  let o = '';
  let err = '';
  const code = await main(argv, { out: (t) => { o += t; }, err: (t) => { err += t; } }, undefined, root);
  return { code, out: o, err };
}

const over = () => firmware({ text: 0x10000 });

test('text report: the map line, the limits, the areas, the regions table, the largest objects, each finding with its quotation and fix, and the gate', () => {
  const o = toText(check(over(), { path: 'firmware.map' }));
  const lines = o.split('\n');
  assert.equal(lines[0], 'linker-map-budget-check: firmware.map');
  assert.equal(lines[1], 'map: GNU ld, 2 regions, 33 lines (21 read, 2 skipped, 10 blank, 0 not parsed), 4 output sections in a region, 0 outside every region, 0 not allocated, 3 input sections from 1 object');
  assert.equal(lines[2], 'limits: near full above 90%, an object above 25% of a region, top 5');
  assert.equal(lines[3], 'areas:');
  assert.match(o, /^ {2}Budget {11}fail {2}region-over-budget x1$/m);
  assert.match(o, /^ {2}Growth {11}off {3}no --baseline given$/m);
  assert.ok(o.includes([
    'regions:',
    '  region  origin      length  budget    used    free     use  attributes',
    '  FLASH   0x08000000  65,536  65,536  65,600     -64  100.1%  xr',
    '  RAM     0x20000000  20,480  20,480   2,112  18,368   10.3%  xrw',
    'largest in FLASH:',
    '   bytes   share  object',
    '  65,600  100.1%  main.o',
    'largest in RAM:'
  ].join('\n')), 'the tables line up their numbers on the right');
  assert.match(o, /^findings: 1 error, 1 warning, 3 info$/m);
  assert.match(o, /^ {2}ERROR {4}region-over-budget {2}firmware\.map region FLASH {2}line 9$/m);
  assert.match(o, /^ {11}basis: "If the combined output sections directed to a memory region are too large for the region, the linker will issue an error message\." \(MEMORY Command, https:\/\/sourceware\.org\/binutils\/docs\/ld\/MEMORY\.html\)$/m);
  assert.match(o, /^ {11}fix: Make the code or data in "FLASH" smaller/m);
  assert.match(o, /\nGATE: FAIL - 1 error\n$/);
});

test('text report: no findings and notes are said before the gate', () => {
  const o = toText(check(gnuMap({ body: [out('.stack', 0x20000000, 0x100)] })));
  assert.match(o, /^findings: 0 error, 0 warning, 0 info\n\nno findings$/m);
  assert.match(o, /\nnote: The map holds none of malloc, _malloc_r, calloc, _calloc_r and 6 more, so the firmware does not seem to take memory from a heap, and no heap reserve was looked for\n\nGATE: PASS \(--fail-on error\)\n$/);
});

test('markdown report: the area table, the regions table, the largest objects, a table per area, the notes as a list and the gate in bold', () => {
  const o = toMarkdown(check(over(), { path: 'firmware.map' }));
  assert.match(o, /^## linker-map-budget-check: 1 error, 1 warning, 3 info$/m);
  assert.match(o, /^\| Area \| Result \| Detail \|$/m);
  assert.match(o, /^\| Region \| Origin \| Length \| Budget \| Used \| Free \| Use \| Attributes \|$/m);
  assert.match(o, /^\| FLASH \| 0x08000000 \| 65,536 \| 65,536 \| 65,600 \| -64 \| 100\.1% \| xr \|$/m);
  assert.match(o, /^Largest in FLASH:$/m);
  assert.match(o, /^### Budget$/m);
  assert.match(o, /^\| Severity \| Check \| Where \| Message \| Basis \| Fix \|$/m);
  assert.match(o, /\*\*Gate failed:\*\* 1 error\./);
  assert.match(toMarkdown(check(firmware())), /\*\*Gate passed\*\* \(--fail-on error\)\./);
  assert.equal(mdCell('x\r\ny'), 'x y');
  assert.equal(mdCell('\\'), '\\\\');
  assert.equal(mdCell('._user_heap_stack'), '.\\_user\\_heap\\_stack');
});

test('json report: the whole report, with the map counts, the areas, the regions, the largest objects, every finding with its basis, the notes and the gate', () => {
  const r = JSON.parse(toJson(check(over(), { path: 'firmware.map', version: '9.9.9' })));
  assert.deepEqual(Object.keys(r), ['tool', 'version', 'map', 'areas', 'regions', 'largest', 'growth', 'findings', 'notes', 'counts', 'gate']);
  assert.equal(r.tool, 'linker-map-budget-check');
  assert.equal(r.version, '9.9.9');
  assert.deepEqual(r.map, { file: 'firmware.map', baseline: null, format: 'gnu-ld', lines: 33, read: 21, skipped: 2, blank: 10, unparsed: 0, regions: 2, outputSections: { inRegion: 4, outsideRegions: 0, notAllocated: 0, empty: 0 }, inputSections: 3, objects: 1, symbols: 4, warnPercent: 90, maxObject: '25%', top: 5, maxGrowth: null });
  assert.deepEqual(r.regions[0], { name: 'FLASH', origin: '0x08000000', length: 65536, budget: 65536, used: 65600, run: 65536, load: 64, free: -64, percent: '100.1%', attributes: 'xr', line: 9 });
  assert.deepEqual(r.areas.map((a) => a.id), ['map', 'budget', 'reserve', 'placement', 'size', 'growth']);
  assert.deepEqual(Object.keys(r.findings[0]), ['id', 'severity', 'area', 'file', 'where', 'line', 'subject', 'message', 'fix', 'basis', 'source']);
  assert.deepEqual(Object.keys(r.findings[0].basis[0]), ['text', 'section', 'source']);
  assert.deepEqual(r.largest[0].objects[0], { name: 'main.o', path: 'main.o', bytes: 65600, share: '100.1%' });
  assert.equal(r.growth, null);
  assert.deepEqual(r.gate, { failOn: 'error', pass: false, reason: '1 error' });
});

test('csv report: RFC 4180, one row per finding, CRLF line ends, quotes doubled, and a leading quote on a cell a spreadsheet would run', () => {
  const o = toCsv(check(over()));
  const lines = o.split('\r\n');
  assert.equal(lines[0], 'severity,area,id,file,where,line,subject,message,basis,source,fix');
  assert.equal(lines.at(-1), '');
  assert.ok(lines[1].startsWith('error,budget,region-over-budget,firmware.map,region FLASH,9,FLASH,'));
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('@a'), "'@a");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell('plain'), 'plain');
});

test('the usage text lists every check, the options and the exit codes', () => {
  for (const f of FINDINGS) assert.ok(USAGE.includes(f.id), f.id);
  assert.match(USAGE, /Exit codes: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error\./);
  for (const o of ['--format <name>', '--fail-on <level>', '--warn-percent <n>', '--budget <region>=<size>', '--max-object <limit>', '--top <n>', '--baseline <map-file>', '--max-growth <limit>']) assert.ok(USAGE.includes(o), o);
  assert.match(USAGE, /info never fails the run/);
});

test('exit code 0: a map with no finding at the level, and --help and --version', async () => {
  assert.equal((await run({ 'f.map': firmware() }, ['f.map', '--fail-on', 'warning'])).code, 0);
  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  assert.equal(help.out, USAGE);
  const version = await cli(['--version']);
  assert.equal(version.code, 0);
  assert.equal(version.out, `${VERSION}\n`);
  assert.equal(VERSION, JSON.parse(await read('package.json')).version);
});

test('exit code 1: an error fails the default gate, a warning fails only --fail-on warning, and info never fails', async () => {
  const error = await run({ 'f.map': over() }, ['f.map']);
  assert.equal(error.code, 1);
  assert.match(error.out, /GATE: FAIL - 1 error/);
  const warning = firmware({ stack: false });
  assert.equal((await run({ 'f.map': warning }, ['f.map'])).code, 0);
  assert.equal((await run({ 'f.map': warning }, ['f.map', '--fail-on', 'warning'])).code, 1);
  const infoRun = await run({ 'f.map': firmware() }, ['f.map', '--fail-on', 'warning']);
  assert.equal(infoRun.code, 0);
  assert.match(infoRun.out, /INFO {5}data-counted-twice/);
  const notMap = await run({ 'f.map': 'hello\n' }, ['f.map', '--fail-on', 'warning']);
  assert.equal(notMap.code, 1, 'a file that is not a map fails the run as an error');
});

test('exit code 1: --budget, --warn-percent, --max-object, --top, --baseline and --max-growth change what is found', async () => {
  const files = { 'f.map': firmware(), 'old.map': firmware({ text: 0x800 }) };
  assert.equal((await run(files, ['f.map', '--budget', 'FLASH=4K'])).code, 1);
  assert.equal((await run(files, ['f.map', '--budget', 'FLASH=0x2000'])).code, 0);
  assert.equal((await run(files, ['f.map', '--budget', 'RAM=5%'])).code, 1);
  assert.equal((await run(files, ['f.map', '--fail-on', 'warning', '--warn-percent', '5'])).code, 1);
  assert.equal((await run(files, ['f.map', '--fail-on', 'warning', '--max-object', '1K'])).code, 1);
  assert.equal((await run(files, ['f.map', '--fail-on', 'warning', '--max-object', '5%'])).code, 1);
  const top = await run(files, ['f.map', '--top', '1']);
  assert.match(top.out, /limits: near full above 90%, an object above 25% of a region, top 1/);
  const grown = await run(files, ['f.map', '--baseline', 'old.map']);
  assert.equal(grown.code, 1);
  assert.match(grown.out, /^linker-map-budget-check: f\.map \(baseline old\.map\)$/m);
  assert.match(grown.out, /ERROR {4}region-growth {2}f\.map region FLASH/);
  assert.equal((await run(files, ['f.map', '--baseline', 'old.map', '--max-growth', '4K'])).code, 0);
});

test('exit code 2: a usage error prints the reason and the usage to the error stream, and nothing to the output', async () => {
  for (const [args, message] of [
    [[], /give the path of a map file/],
    [['f.map', 'g.map'], /give one map file; give an older map with --baseline/],
    [['f.map', '--nope'], /unknown argument --nope/],
    [['f.map', '--format'], /--format needs a value/],
    [['f.map', '--format', 'xml'], /unknown format xml/],
    [['f.map', '--fail-on', 'info'], /--fail-on takes error or warning, not info/],
    [['f.map', '--warn-percent', '0'], /--warn-percent takes a number from 1 to 100, not 0/],
    [['f.map', '--warn-percent', 'most'], /--warn-percent takes a number/],
    [['f.map', '--budget', 'FLASH'], /--budget takes <region>=<size>/],
    [['f.map', '--budget', 'FLASH=0'], /--budget takes <region>=<size>/],
    [['f.map', '--budget', 'FLASH=1.5M'], /--budget takes <region>=<size>/],
    [['f.map', '--budget', 'FLASH=1K', '--budget', 'FLASH=2K'], /--budget is given twice for FLASH/],
    [['f.map', '--max-object', '0'], /--max-object takes a size/],
    [['f.map', '--max-object', '200%'], /--max-object takes a size/],
    [['f.map', '--top', '0'], /--top takes a whole number from 1 to 100, not 0/],
    [['f.map', '--max-growth', '1K'], /--max-growth needs --baseline/],
    [['f.map', '--baseline', 'f.map'], /the baseline is the same file as the map/],
    [['f.map', '--baseline', 'a.map', '--baseline', 'b.map'], /--baseline is given twice/],
    [['https://example.test/f.map'], /never fetches a URL/],
    [['-'], /standard input is not supported/]
  ]) {
    const r = await run({ 'f.map': firmware() }, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.equal(r.out, '');
    assert.match(r.err, message);
    assert.match(r.err, /Usage: linker-map-budget-check/);
  }
});

test('exit code 2: an input that cannot be read is reported with its name and the reason, never as a pass', async () => {
  const cases = [
    [{}, ['missing.map'], /missing\.map: no such file/],
    [{ 'sub/a.map': 'x' }, ['sub'], /sub: a folder, not a file/],
    [{ 'f.map': firmware() }, ['f.map', '--baseline', 'none.map'], /none\.map: no such file/],
    [{ 'f.map': firmware(), 'old.map': 'not a map\n' }, ['f.map', '--baseline', 'old.map'], /old\.map: the baseline is a text file with no "Memory Configuration" and "Linker script and memory map" line/]
  ];
  for (const [files, args, message] of cases) {
    const r = await run(files, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.equal(r.out, '');
    assert.match(r.err, message);
  }
});

test('exit code 2: a file over the size limit is refused before it is read', async () => {
  const r = await run({ 'f.map': firmware() }, ['f.map'], { maxFileBytes: 20 });
  assert.equal(r.code, 2);
  assert.match(r.err, /f\.map: [\d,]+ bytes is over the 20 byte limit/);
});

test('checkFile: the paths relative to the base, with the baseline', async () => {
  const r = await checkFile('examples/thermostat-next.map', { base: root, baselinePath: 'examples/thermostat-fixed.map' });
  assert.equal(r.map.file, 'examples/thermostat-next.map');
  assert.equal(r.map.baseline, 'examples/thermostat-fixed.map');
  assert.equal(r.growth.length, 3);
});

test('paths in the report are relative to the base with forward slashes, for a file in a folder', async () => {
  const r = await run({ 'build/debug/f.map': over() }, ['build/debug/f.map']);
  assert.match(r.out, /^linker-map-budget-check: build\/debug\/f\.map$/m);
  assert.match(r.out, /ERROR {4}region-over-budget {2}build\/debug\/f\.map region FLASH/);
  const err = await run({}, ['build/none.map']);
  assert.match(err.err, /build\/none\.map: no such file/);
});

test('paths on Windows: a backslash separates the folders, and the report still shows forward slashes', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('a backslash is an ordinary character in a file name on this system');
    return;
  }
  const r = await run({ 'build/f.map': over() }, ['build\\f.map']);
  assert.equal(r.code, 1);
  assert.match(r.out, /^linker-map-budget-check: build\/f\.map$/m);
});

test('paths on Linux and macOS: a backslash is part of the file name, which is read under that name', async (t) => {
  if (process.platform === 'win32') {
    t.skip('a backslash separates folders on Windows');
    return;
  }
  const r = await run({ 'we\\ird.map': over() }, ['we\\ird.map']);
  assert.equal(r.code, 1);
  assert.match(r.out, /we\\ird\.map/);
});

test('the example maps: the broken one fails with the findings the README names, the fixed one passes at the strictest level, the growth check fails', async () => {
  const broken = await inRoot(['examples/thermostat.map', '--fail-on', 'warning']);
  assert.equal(broken.code, 1);
  for (const f of FINDINGS.filter((x) => !['unknown-format', 'region-growth', 'object-growth', 'unparsed-lines'].includes(x.id))) assert.ok(broken.out.includes(`  ${f.id}  `), f.id);
  const fixed = await inRoot(['examples/thermostat-fixed.map', '--fail-on', 'warning']);
  assert.equal(fixed.code, 0);
  assert.match(fixed.out, /findings: 0 error, 0 warning, 4 info/);
  const next = await inRoot(['examples/thermostat-next.map', '--fail-on', 'warning']);
  assert.equal(next.code, 0, 'the next build passes on its own; only the growth check fails it');
  const growth = await inRoot(['examples/thermostat-next.map', '--baseline', 'examples/thermostat-fixed.map']);
  assert.equal(growth.code, 1);
  for (const id of ['region-growth', 'object-growth']) assert.ok(growth.out.includes(`  ${id}  `), id);
  const lld = await inRoot(['examples/thermostat-lld.map']);
  assert.equal(lld.code, 1);
  assert.match(lld.out, /unknown-format/);
});

test('the example maps give the same report with CRLF line ends as with LF', async () => {
  for (const name of ['thermostat.map', 'thermostat-fixed.map']) {
    const lf = await read(`examples/${name}`);
    const a = await run({ [name]: lf }, [name, '--format', 'json']);
    const b = await run({ [name]: lf.split('\n').join('\r\n') }, [name, '--format', 'json']);
    assert.equal(a.code, b.code);
    assert.equal(b.out, a.out, name);
  }
});

test('the example output files are the real output, in every format', async () => {
  const args = ['examples/thermostat.map', '--fail-on', 'warning'];
  assert.equal((await inRoot(args)).out, await read('examples/output/thermostat.txt'));
  assert.equal((await inRoot([...args, '--format', 'markdown'])).out, await read('examples/output/thermostat.md'));
  assert.equal((await inRoot([...args, '--format', 'json'])).out, await read('examples/output/thermostat.json'));
  const csv = (await inRoot([...args, '--format', 'csv'])).out;
  assert.equal(csv, await read('examples/output/thermostat.csv'));
  assert.ok(csv.includes('\r\n'));
  assert.equal((await inRoot(['examples/thermostat-fixed.map', '--fail-on', 'warning'])).out, await read('examples/output/thermostat-fixed.txt'));
  assert.equal((await inRoot(['examples/thermostat-next.map', '--baseline', 'examples/thermostat-fixed.map'])).out, await read('examples/output/thermostat-growth.txt'));
  assert.equal((await inRoot(['examples/thermostat-lld.map'])).out, await read('examples/output/thermostat-lld.txt'));
});

test('parseArgs: the defaults, and options in any order', () => {
  assert.deepEqual(parseArgs(['f.map']), { file: 'f.map', format: 'text', failOn: 'error', warnPercent: 90, budgets: [], maxObject: { percent: 25 }, top: 5, baseline: null, maxGrowth: { percent: 1 }, help: false, version: false });
  assert.deepEqual(parseArgs(['--fail-on', 'warning', '--budget', 'FLASH=480K', 'f.map', '--format', 'csv', '--budget', 'RAM=75%', '--warn-percent', '85.5', '--max-object', '16K', '--top', '10', '--baseline', 'old.map', '--max-growth', '512']), { file: 'f.map', format: 'csv', failOn: 'warning', warnPercent: 85.5, budgets: [{ region: 'FLASH', limit: { bytes: 491520 } }, { region: 'RAM', limit: { percent: 75 } }], maxObject: { bytes: 16384 }, top: 10, baseline: 'old.map', maxGrowth: { bytes: 512 }, help: false, version: false });
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['-v']).version, true);
});

test('an input section line holds the object path only, so no other text of the map reaches a finding', () => {
  const marker = 'MARKER-NOT-A-PATH';
  const r = check(gnuMap({ body: [out('.text', 0x08000000, 0x10), inp('.text', 0x08000000, 0x10, 'main.o'), `                0x08000000                ${marker} = .`, out('.stack', 0x20000000, 0x10)] }));
  for (const o of [toText(r), toMarkdown(r), toCsv(r), toJson(r)]) assert.ok(!o.includes(marker));
});

test('files: readBounded reads a regular file under the limit, fileError keeps the reason apart, displayPath shows forward slashes', async () => {
  const bytes = await readBounded(resolve(root, 'examples/thermostat-lld.map'), 1_000_000);
  assert.ok(bytes.toString('utf8').startsWith('             VMA'));
  await assert.rejects(readBounded(resolve(root, 'examples/thermostat-lld.map'), 10), /over the 10 byte limit/);
  assert.equal(fileError('a.map', 'no such file').reason, 'no such file');
  assert.equal(displayPath(resolve(root, 'examples/x.map'), root), 'examples/x.map');
  assert.equal(displayPath(root, root), '.');
  assert.ok(!displayPath(resolve(root, '..', 'elsewhere.map'), root).includes(String.fromCharCode(92)));
});
