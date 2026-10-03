// Runs the README examples, checks that they report what the README shows, and writes the reports of the first example
// to examples/output. CI runs it and then fails if those files changed, so the example output in the repository is
// always the real output.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/index.js';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');

// Runs the tool on files of the repository; the paths shown in the report are relative to the root of the repository.
async function run(argv) {
  let out = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => process.stderr.write(t) }, undefined, root);
  return { code, out };
}

const problems = [];
function expect(name, result, code, expected, unwanted) {
  const missing = expected.filter((e) => !result.out.includes(e));
  const wrong = unwanted.filter((e) => result.out.includes(e));
  if (result.code !== code || missing.length || wrong.length) {
    problems.push(`${name}: unexpected report (exit code ${result.code}, expected ${code}; missing: ${missing.join(' / ') || 'none'}; should not appear: ${wrong.join(' / ') || 'none'})`);
  }
}

const brokenArgs = ['examples/thermostat.map', '--fail-on', 'warning'];
const broken = await run(brokenArgs);
process.stdout.write(broken.out);
expect('thermostat', broken, 1, [
  'map: GNU ld, 2 regions, 329 lines',
  'findings: 1 error, 6 warning, 3 info',
  '  FLASH   0x08000000  65,536  65,536  66,124   -588  100.9%  xr',
  '  RAM     0x20000000  20,480  20,480  19,136  1,344   93.4%  xrw',
  'ERROR    region-over-budget  examples/thermostat.map region FLASH',
  'WARNING  region-near-full  examples/thermostat.map region RAM',
  'WARNING  no-stack-reserve  examples/thermostat.map stack',
  'WARNING  no-heap-reserve  examples/thermostat.map heap',
  'WARNING  orphan-section  examples/thermostat.map section .ccmram',
  'WARNING  large-input-section  examples/thermostat.map object build/font_8x16.o in FLASH',
  'WARNING  large-input-section  examples/thermostat.map object build/ble.o in RAM',
  'INFO     data-counted-twice  examples/thermostat.map section .data',
  'INFO     top-objects  examples/thermostat.map region FLASH',
  'GATE: FAIL - 1 error, 6 warnings'
], ['GATE: PASS', 'unparsed-lines']);

process.stdout.write('\n');
const fixed = await run(['examples/thermostat-fixed.map', '--fail-on', 'warning']);
process.stdout.write(fixed.out);
expect('fixed thermostat with --fail-on warning', fixed, 0, ['findings: 0 error, 0 warning, 4 info', 'INFO     data-counted-twice', 'GATE: PASS (--fail-on warning)'], ['ERROR', 'WARNING ']);

process.stdout.write('\n');
const growth = await run(['examples/thermostat-next.map', '--baseline', 'examples/thermostat-fixed.map']);
process.stdout.write(growth.out);
expect('growth against the fixed map', growth, 1, [
  'growth since examples/thermostat-fixed.map:',
  'ERROR    region-growth  examples/thermostat-next.map region FLASH',
  'ERROR    region-growth  examples/thermostat-next.map region RAM',
  'WARNING  object-growth  examples/thermostat-next.map object build/ota.o in FLASH',
  'WARNING  object-growth  examples/thermostat-next.map object build/main.o in FLASH',
  'GATE: FAIL - 2 errors'
], ['GATE: PASS']);

const lld = await run(['examples/thermostat-lld.map']);
expect('lld map', lld, 1, ['ERROR    unknown-format  examples/thermostat-lld.map map  line 1', 'The file is an LLVM lld map file.', 'GATE: FAIL - 1 error'], ['GATE: PASS']);

// The README shows the first three runs as they are printed.
const readme = (await readFile(resolve(root, 'README.md'), 'utf8')).split('\r\n').join('\n');
if (!readme.includes(broken.out)) problems.push('README: the sample output of the broken thermostat differs from a real run');
if (!readme.includes(fixed.out)) problems.push('README: the sample output of the fixed thermostat differs from a real run');
if (!readme.includes(growth.out)) problems.push('README: the sample output of the growth check differs from a real run');

// The same map in the other formats, kept as examples of what each one looks like.
await mkdir(resolve(root, 'examples/output'), { recursive: true });
await writeFile(resolve(root, 'examples/output/thermostat.txt'), broken.out);
for (const [format, name] of [['markdown', 'thermostat.md'], ['json', 'thermostat.json'], ['csv', 'thermostat.csv']]) {
  const r = await run([...brokenArgs, '--format', format]);
  if (r.code !== 1) problems.push(`${format}: exit code ${r.code}, expected 1`);
  await writeFile(resolve(root, 'examples/output', name), r.out);
}
await writeFile(resolve(root, 'examples/output/thermostat-fixed.txt'), fixed.out);
await writeFile(resolve(root, 'examples/output/thermostat-growth.txt'), growth.out);
await writeFile(resolve(root, 'examples/output/thermostat-lld.txt'), lld.out);

if (problems.length) {
  for (const p of problems) console.error(`example: ${p}`);
  process.exit(1);
}
