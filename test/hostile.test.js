import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LIMITS, MAP_LIMITS, main, parseMap, toCsv, toMarkdown, toText } from '../src/index.js';
import { check, find, firmware, gnuMap, inp, out, run, withFiles } from './helpers.js';

// Hostile input: a map file that tries to exhaust the memory or the time, to make the tool read more than it was given,
// to rewrite the terminal, to break a table or to change how objects behave. Each test also checks the time, because a
// pattern that grows with the input is a failure even when the answer is right.

const LIMIT = { timeout: 30000 };
const fast = async (fn, ms = 4000) => {
  const start = Date.now();
  const result = await fn();
  assert.ok(Date.now() - start < ms, `took ${Date.now() - start} ms`);
  return result;
};

test('hostile: a file over the default size limit is refused from its size, before it is read', LIMIT, async () => {
  await withFiles({}, async (dir) => {
    await writeFile(resolve(dir, 'big.map'), Buffer.alloc(LIMITS.maxFileBytes + 10, 0x20));
    let err = '';
    const code = await fast(() => main(['big.map'], { out: () => {}, err: (t) => { err += t; } }, undefined, dir));
    assert.equal(code, 2);
    assert.match(err, /big\.map: 33,554,442 bytes is over the 32 MB limit/);
  });
});

test('hostile: more lines than the limit are refused with a message', LIMIT, async () => {
  const r = await fast(() => run({ 'f.map': '\n'.repeat(MAP_LIMITS.maxLines + 1) }, ['f.map']));
  assert.equal(r.code, 2);
  assert.match(r.err, /f\.map|more than 2,000,000 lines/);
  assert.match(r.err, /more than 2,000,000 lines/);
});

test('hostile: very long lines are counted as not parsed without running a pattern on them, in one pass', LIMIT, async () => {
  const long = `.text${' '.repeat(5000)}0x08000000 0x10`;
  const near = ` ${'a'.repeat(4000)} 0x`;
  const symbolNear = `${' '.repeat(3000)}0x${'1'.repeat(16)}${' '.repeat(1000)}`;
  const text = gnuMap({ body: [out('.text', 0x08000000, 0x10), long, `x${'y'.repeat(1_000_000)}`, near, symbolNear, ` ${'('.repeat(4000)}`, ` *${' 0x1'.repeat(1000)}`] });
  const m = await fast(() => parseMap(text));
  assert.equal(m.counts.unparsed, 4);
  assert.equal(m.sections.length, 1);
  assert.ok(m.unparsed.every((u) => u.text.length <= 400));
  const r = await fast(() => check(text));
  assert.equal(find(r, 'unparsed-lines').length, 1);
  assert.ok(find(r, 'unparsed-lines')[0].message.length < 1300);
});

test('hostile: more regions, sections, input sections or symbols than the limits are refused', LIMIT, async () => {
  const regions = Array.from({ length: 257 }, (_, i) => `R${i}               0x${(i * 0x1000).toString(16).padStart(8, '0')}         0x00001000`);
  assert.throws(() => parseMap(gnuMap({ regions })), /more than 256 memory regions/);
  const small = { ...MAP_LIMITS, maxSections: 3, maxInputSections: 3, maxSymbols: 3 };
  assert.throws(() => parseMap(gnuMap({ body: [out('.a', 0x08000000, 1), out('.b', 0x08000001, 1), out('.c', 0x08000002, 1), out('.d', 0x08000003, 1)] }), small), /more than 3 output sections/);
  assert.throws(() => parseMap(gnuMap({ body: [out('.a', 0x08000000, 4), ...[0, 1, 2, 3].map((i) => inp('.x', 0x08000000 + i, 1, 'a.o'))] }), small), /more than 3 input sections/);
  assert.throws(() => parseMap(gnuMap({ body: Array.from({ length: 4 }, (_, i) => `                0x0000000${i}                s${i}`) }), small), /more than 3 symbols/);
  const r = await run({ 'f.map': gnuMap({ regions }) }, ['f.map']);
  assert.equal(r.code, 2);
  assert.match(r.err, /f\.map|more than 256 memory regions/);
});

test('hostile: a map with tens of thousands of input sections is checked in time, and findings of one kind are capped at 200', LIMIT, async () => {
  const body = [out('.text', 0x08000000, 0x10000)];
  for (let i = 0; i < 30000; i += 1) body.push(inp(`.text.f${i}`, 0x08000000 + i * 2, 2, `obj/o${i % 3000}.o`));
  body.push(out('.stack', 0x20000000, 0x400));
  const r = await fast(() => check(gnuMap({ body }), { maxObject: { bytes: 1 } }), 8000);
  assert.equal(find(r, 'large-input-section').length, 200);
  assert.equal(r.counts.warning - find(r, 'region-near-full').length, 3000);
  assert.ok(r.notes.some((n) => /2,800 more findings of large-input-section are counted but not listed/.test(n)));
  assert.match(r.areas.find((a) => a.id === 'size').detail, /large-input-section x3000/);
});

test('hostile: section, object and symbol names made of control, direction and line separator characters are cleaned in every format', LIMIT, () => {
  const bad = ['x', String.fromCharCode(27), '[31m', String.fromCharCode(0x202e), 'y', String.fromCharCode(0x2028), 'z', String.fromCharCode(0x85)].join('');
  // A line separator is white space to the reader, so a section name cannot hold one; it is used in a file name and an
  // unparsed line instead.
  const name = bad.split(String.fromCharCode(0x2028)).join('');
  const text = gnuMap({ body: [out(`.t${name}`, 0x10000000, 0x10), inp('.text', 0x10000000, 0x10, `${bad}.o`), out('.text', 0x08000000, 0x10), inp('.text', 0x08000000, 0x10, `${bad}.o`), `?${bad}`] });
  const r = check(text);
  assert.equal(find(r, 'orphan-section').length, 1);
  assert.equal(find(r, 'unparsed-lines').length, 1);
  for (const o of [toText(r), toMarkdown(r), toCsv(r), JSON.stringify(r)]) {
    for (const code of [27, 0x202e, 0x2028, 0x85]) assert.ok(!o.includes(String.fromCharCode(code)), `character ${code}`);
  }
});

test('hostile: a binary file, an ELF file and a file with a null byte are reported as not a map, never a crash', LIMIT, async () => {
  for (const [content, kind] of [[Buffer.from([0, 1, 2, 3, 255, 254]), /a binary file/], [Buffer.from('\x7fELF\x01\x01\x01\x00\x00'), /an ELF file, not its map/], [Buffer.from('Memory Configuration\n\u0000\nLinker script and memory map\n'), /a binary file/]]) {
    const r = await run({ 'f.map': content }, ['f.map']);
    assert.equal(r.code, 1);
    assert.match(r.out, kind);
    assert.ok(!r.out.includes(String.fromCharCode(0)));
  }
});

test('hostile: names such as __proto__, constructor and toString are only names', LIMIT, () => {
  const text = gnuMap({ body: [out('__proto__', 0x08000000, 0x10), inp('constructor', 0x08000000, 0x10, '__proto__'), inp('toString', 0x08000010, 0x0, 'hasOwnProperty'), out('.stack', 0x20000000, 0x10)], regions: ['__proto__        0x08000000         0x00010000         xr', 'RAM              0x20000000         0x00001000         rw'] });
  const r = check(text, { budgets: [{ region: '__proto__', limit: { bytes: 8 } }] });
  assert.deepEqual(r.regions.map((g) => g.name), ['__proto__', 'RAM']);
  assert.equal(find(r, 'region-over-budget')[0].subject, '__proto__');
  assert.equal(r.largest[0].objects[0].name, '__proto__');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
  assert.equal(Object.keys({}).length, 0);
});

test('hostile: an object name that starts with = or holds markup cannot run in a spreadsheet or break a Markdown table', LIMIT, () => {
  const evil = '=HYPERLINK("x","y")|a<script>[click](https://evil.example.test)`x`.o';
  const r = check(gnuMap({ body: [out('.text', 0x08000000, 0x10), inp('.text', 0x08000000, 0x10, evil), out('.stack', 0x20000000, 0x10)] }), { maxObject: { bytes: 1 } });
  const md = toMarkdown(r);
  assert.ok(!md.includes('<script>'));
  assert.ok(!md.includes('[click]('));
  for (const row of md.split('\n').filter((l) => l.startsWith('| warning |'))) assert.equal(row.replace(/\\\|/g, '').split('|').length, 8, row.slice(0, 80));
  const csv = toCsv(r);
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"",""y"")`));
});

test('hostile: an argument that is a URL, a very long path, or a path with control characters is refused or reported cleanly', LIMIT, async () => {
  const url = await run({}, ['https://example.test/firmware.map']);
  assert.equal(url.code, 2);
  assert.match(url.err, /never fetches a URL/);
  const baseUrl = await run({ 'f.map': firmware() }, ['f.map', '--baseline', 'file://x/old.map']);
  assert.match(baseUrl.err, /never fetches a URL/);
  const long = await run({}, [`${'a'.repeat(5000)}.map`]);
  assert.equal(long.code, 2);
  assert.ok(long.err.length < 8000);
  const control = await run({}, [`x${String.fromCharCode(27)}[31mfile.map`]);
  assert.equal(control.code, 2);
  assert.ok(!control.err.includes(String.fromCharCode(27)));
});

test('hostile: a file name with control characters is cleaned in the report, where the system allows such a name', LIMIT, async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows does not allow a control character in a file name');
    return;
  }
  const name = `evil${String.fromCharCode(27)}[31m.map`;
  let r;
  try {
    r = await run({ [name]: firmware() }, [name]);
  } catch (error) {
    if (!['EINVAL', 'EILSEQ', 'ENOENT', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    t.skip(`this file system does not allow the name (${error.code})`);
    return;
  }
  assert.equal(r.code, 0);
  assert.ok(!r.out.includes(String.fromCharCode(27)));
});

test('hostile: a device or a pipe in place of the file is refused without being opened', LIMIT, async (t) => {
  if (process.platform === 'win32') {
    t.skip('there is no device file at this path on Windows');
    return;
  }
  const r = await run({}, ['/dev/null']);
  assert.equal(r.code, 2);
  assert.match(r.err, /not a regular file/);
});

test('hostile: a symbolic link to a folder is refused, and one to a file is followed because the person gave it', LIMIT, async (t) => {
  if (process.platform === 'win32') {
    t.skip('creating a symbolic link needs a privilege on Windows');
    return;
  }
  await withFiles({ 'real.map': firmware() }, async (dir) => {
    await mkdir(resolve(dir, 'folder'));
    await symlink(resolve(dir, 'folder'), resolve(dir, 'dirlink'));
    await symlink(resolve(dir, 'real.map'), resolve(dir, 'filelink.map'));
    let err = '';
    assert.equal(await main(['dirlink'], { out: () => {}, err: (x) => { err += x; } }, undefined, dir), 2);
    assert.match(err, /a folder, not a file/);
    let o = '';
    assert.equal(await main(['filelink.map'], { out: (x) => { o += x; }, err: () => {} }, undefined, dir), 0);
    assert.match(o, /filelink\.map/);
  });
});
