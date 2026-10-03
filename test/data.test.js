import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { FACTS, FINDINGS, HEAP, HEAP_USERS, MAP_HEADERS, NOT_ALLOCATED_PREFIXES, SOURCES, STACK, ZERO_INIT_WORDS, factPage, source } from '../src/index.js';

// These tests read the saved pages of the GNU ld manual again and compare them with src/data.js: every sentence that a
// finding or a document quotes.

const text = async (id) => readFile(new URL(`../research/sources/${source(id).file}`, import.meta.url), 'utf8');
// Text compared without line breaks or runs of white space.
const flat = (t) => t.replace(/\s+/g, ' ').trim();
const has = (page, needle) => flat(page).includes(flat(needle));
// The words of a tool that wrote a text, built from pieces so that this file does not hold them.
const WRITTEN = new RegExp(`\\b(?:${['A', 'I'].join('')}|${['cha', 't'].join('')}|${['clau', 'de'].join('')}|${['anthro', 'pic'].join('')}|${['ope', 'nai'].join('')}|${['gene', 'rated'].join('')}|${['assis', 'tant'].join('')})\\b`, 'i');
const YEAR = /\b(?:19|20)\d{2}\b/;

test('sources: every saved page has its address on the first line, as listed in src/data.js, and holds text', async () => {
  for (const s of SOURCES) {
    const page = await text(s.id);
    assert.equal(page.split('\n')[0], `Source: ${s.url}`, s.file);
    assert.ok(page.length > 800, `${s.file} holds the page text`);
    assert.match(s.url, /^https:\/\/sourceware\.org\/binutils\/docs\/ld\/[A-Za-z-]+\.html$/);
  }
  assert.equal(SOURCES.length, new Set(SOURCES.map((s) => s.url)).size);
  assert.equal(SOURCES.length, new Set(SOURCES.map((s) => s.file)).size);
  assert.equal(SOURCES.length, new Set(SOURCES.map((s) => s.id)).size);
});

test('sources: every file in research/sources is listed in src/data.js, and the other way round', async () => {
  const files = (await readdir(new URL('../research/sources/', import.meta.url))).sort();
  assert.deepEqual(files, SOURCES.map((s) => s.file).sort());
});

test('sources: the pages are the MEMORY command, the map options, the output section LMA and description, orphans, the concepts and the location counter', () => {
  assert.deepEqual(SOURCES.map((s) => new URL(s.url).pathname.split('/').at(-1)).sort(), ['Basic-Script-Concepts.html', 'Location-Counter.html', 'MEMORY.html', 'Options.html', 'Orphan-Sections.html', 'Output-Section-Description.html', 'Output-Section-LMA.html']);
});

test('sources: no saved page holds a year, a mention of a tool that wrote it, a control byte, a carriage return or a character that is not ASCII', async () => {
  for (const s of SOURCES) {
    const page = await text(s.id);
    assert.doesNotMatch(page, YEAR, s.file);
    assert.doesNotMatch(page, WRITTEN, s.file);
    assert.doesNotMatch(page, new RegExp(`[${String.fromCharCode(1)}-${String.fromCharCode(8)}]`), s.file);
    assert.ok(!page.includes('\r'), s.file);
    assert.ok([...page].every((c) => c.charCodeAt(0) < 128), s.file);
  }
});

test('the saved pages show what the reader relies on: the MEMORY syntax, -Map, the load address and the output section syntax', async () => {
  const memory = await text('ld-memory');
  assert.ok(has(memory, 'name [(attr)] : ORIGIN = origin, LENGTH = len'));
  assert.ok(has(memory, 'rom (rx) : ORIGIN = 0, LENGTH = 256K'), 'K means kilobytes, as --budget reads it');
  const map = await text('ld-map');
  assert.ok(has(map, '-Map=mapfile'));
  assert.ok(has(map, 'Memory region Used Size Region Size %age Used'));
  assert.ok(has(await text('ld-lma'), 'The AT keyword takes an expression as an argument.'));
  assert.ok(has(await text('ld-output-section'), '} [>region] [AT>lma_region] [:phdr :phdr ...] [=fillexp] [,]'));
  assert.ok(has(await text('ld-dot'), '. = . + 1000;'), 'stepping the location counter is how a reserve is made');
});

test('facts: every quoted sentence is on its saved page, word for word, with no year and no mention of a tool that wrote it', async () => {
  for (const [key, fact] of Object.entries(FACTS)) {
    assert.ok(SOURCES.some((s) => s.id === fact.source), key);
    assert.ok(has(await text(fact.source), fact.text), `${key}: "${fact.text}"`);
    assert.ok(fact.section.length > 3, key);
    assert.doesNotMatch(fact.text, YEAR, key);
    assert.doesNotMatch(fact.text, WRITTEN, key);
    assert.ok(fact.text.length <= 240, `${key} is short`);
    assert.equal(factPage(key), source(fact.source).url);
  }
});

test('facts: every finding quotes sentences of src/data.js, and every source page is quoted at least once', () => {
  for (const f of FINDINGS) {
    assert.ok(['error', 'warning', 'info'].includes(f.severity), f.id);
    assert.match(f.id, /^[a-z]+(?:-[a-z]+)*$/, f.id);
    assert.ok(f.what.length > 20, f.id);
    assert.ok(f.facts.length >= 1, f.id);
    for (const k of f.facts) assert.ok(FACTS[k], `${f.id}: ${k}`);
  }
  const quoted = new Set(Object.values(FACTS).map((f) => f.source));
  for (const s of SOURCES) assert.ok(quoted.has(s.id), s.id);
  assert.deepEqual(FINDINGS.filter((f) => f.severity === 'error').map((f) => f.id), ['unknown-format', 'region-over-budget', 'region-growth']);
  assert.deepEqual(FINDINGS.filter((f) => f.severity === 'warning').map((f) => f.id), ['region-near-full', 'no-stack-reserve', 'no-heap-reserve', 'orphan-section', 'large-input-section', 'object-growth']);
  assert.deepEqual(FINDINGS.filter((f) => f.severity === 'info').map((f) => f.id), ['data-counted-twice', 'top-objects', 'unparsed-lines']);
});

test('lists: the stack and heap names, the heap users and the section words have no duplicates and do not overlap', () => {
  for (const kind of [STACK, HEAP]) {
    const all = [...kind.sizeSymbols, ...kind.limitSymbols, ...kind.topSymbols];
    assert.equal(new Set(all).size, all.length, kind.word);
  }
  for (const n of [...STACK.sizeSymbols, ...STACK.limitSymbols, ...STACK.topSymbols]) assert.ok(![...HEAP.sizeSymbols, ...HEAP.limitSymbols, ...HEAP.topSymbols].includes(n), n);
  assert.ok(STACK.sizeSymbols.includes('_Min_Stack_Size') && STACK.topSymbols.includes('_estack') && STACK.limitSymbols.includes('__StackLimit'));
  assert.ok(HEAP.sizeSymbols.includes('_Min_Heap_Size') && HEAP.limitSymbols.includes('__HeapLimit'));
  for (const list of [HEAP_USERS, NOT_ALLOCATED_PREFIXES, ZERO_INIT_WORDS]) assert.equal(new Set(list).size, list.length);
  for (const w of ZERO_INIT_WORDS) assert.equal(w, w.toLowerCase(), w);
  for (const p of NOT_ALLOCATED_PREFIXES) assert.ok(p.startsWith('.'), p);
});

test('src writes no map header outside src/data.js', async () => {
  const headers = [MAP_HEADERS.memory, MAP_HEADERS.map, MAP_HEADERS.common, MAP_HEADERS.discarded, MAP_HEADERS.cref, ...MAP_HEADERS.archive, '*default*', '/DISCARD/', '*fill*'];
  for (const file of ['rules.js', 'check.js', 'mapfile.js', 'report.js', 'cli.js', 'size.js']) {
    const lines = (await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')).split(String.fromCharCode(10));
    const code = lines.filter((l) => !l.trim().startsWith('//')).join(String.fromCharCode(10));
    for (const h of headers) assert.ok(!code.includes(`'${h}'`) && !code.includes(`"${h}"`), `${file} writes '${h}' itself`);
  }
});

test('docs: every sentence that the documents quote from a saved page is on a saved page', async () => {
  const pages = (await Promise.all(SOURCES.map((s) => text(s.id)))).map(flat).join(' ');
  let checked = 0;
  for (const file of ['docs/method.md', 'docs/rules-and-sources.md', 'docs/inputs.md', 'docs/limits.md', 'docs/decisions/0001-read-the-map-not-the-elf.md', 'README.md']) {
    const doc = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const prose = file === 'README.md' ? doc.replace(/```[\s\S]*?```/g, '') : doc;
    for (const m of prose.matchAll(/"([^"\n]{40,400})"/g)) {
      assert.ok(pages.includes(flat(m[1])), `${file}: ${m[1]}`);
      checked += 1;
    }
  }
  assert.ok(checked >= 30, `${checked} quotes checked`);
});

test('docs: docs/rules-and-sources.md names every saved page, every quoted sentence and every finding', async () => {
  const doc = await readFile(new URL('../docs/rules-and-sources.md', import.meta.url), 'utf8');
  for (const s of SOURCES) {
    assert.ok(doc.includes(s.file), s.file);
    assert.ok(doc.includes(s.url), s.url);
  }
  for (const [key, fact] of Object.entries(FACTS)) assert.ok(doc.includes(`| \`${key}\` |`) && doc.includes(fact.text), key);
  for (const f of FINDINGS) {
    assert.ok(doc.includes(`| \`${f.id}\` | ${f.severity} |`), f.id);
    assert.ok(doc.includes(`(method.md#${f.id}-${f.severity})`), f.id);
    for (const k of f.facts) assert.ok(new RegExp(`\\| \`${k}\` \\| [^|]*\`${f.id}\``).test(doc), `${k} is used by ${f.id}`);
  }
});
