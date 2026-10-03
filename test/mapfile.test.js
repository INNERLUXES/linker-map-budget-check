import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectFormat, parseLimit, parseMap, parseSize, readMap, splitLines, limitBytes, limitText, bytesText, grouped, hex, percentText } from '../src/index.js';
import { gnuMap, inp, out, region, sym } from './helpers.js';

const example = (name) => readFile(new URL(`../examples/${name}`, import.meta.url), 'utf8');

test('splitLines: LF, CRLF and a lone CR end a line, and a final line break adds no empty line', () => {
  assert.deepEqual(splitLines('a\nb\n'), ['a', 'b']);
  assert.deepEqual(splitLines('a\r\nb\r\n'), ['a', 'b']);
  assert.deepEqual(splitLines('a\rb'), ['a', 'b']);
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('a\n\nb'), ['a', '', 'b']);
});

test('detectFormat: a GNU ld map needs both headers; lld, IAR, armlink, ELF, binary and empty files are named', () => {
  assert.equal(detectFormat(gnuMap()).kind, 'gnu-ld');
  assert.equal(detectFormat('Memory Configuration\n').kind, 'unknown');
  assert.match(detectFormat('Memory Configuration\n').name, /no "Linker script and memory map" line/);
  assert.equal(detectFormat('             VMA              LMA     Size Align Out     In      Symbol\n').kind, 'lld');
  assert.equal(detectFormat('###############\n#  IAR ELF Linker V9.40.1 for ARM\n').kind, 'iar');
  assert.equal(detectFormat('==============\n\nMemory Map of the image\n').kind, 'armlink');
  assert.equal(detectFormat(' Preferred load address is 00400000\n').kind, 'msvc');
  assert.equal(detectFormat('\x7fELF\x01\x01\x01').kind, 'elf');
  assert.equal(detectFormat('abc\u0000def').kind, 'binary');
  assert.equal(detectFormat('\n\n  \n').kind, 'empty');
  assert.equal(detectFormat('hello\n').kind, 'unknown');
});

test('regions: name, origin, length and attributes from the Memory Configuration table; *default* is kept apart', () => {
  const m = parseMap(gnuMap({ regions: [region('FLASH', 0x08000000, 0x80000, 'xr'), region('RAM', 0x20000000, 0x20000, 'xrw'), region('BACKUP_SRAM_WITH_A_LONG_NAME', 0x40024000, 0x1000, 'rw !x')] }));
  assert.deepEqual(m.regions.map((r) => [r.name, r.origin, r.length, r.attributes]), [['FLASH', 0x08000000n, 0x80000n, 'xr'], ['RAM', 0x20000000n, 0x20000n, 'xrw'], ['BACKUP_SRAM_WITH_A_LONG_NAME', 0x40024000n, 0x1000n, 'rw !x']]);
  assert.equal(m.defaultRegion.name, '*default*');
  assert.equal(m.regions[0].line, 9);
  assert.equal(m.counts.unparsed, 0);
});

test('regions: 64-bit origins and lengths are read exactly, as for a RISC-V target', () => {
  const m = parseMap(gnuMap({ regions: ['ram              0x0000000080000000 0x0000000000100000 xrw'] }));
  assert.equal(m.regions[0].origin, 0x80000000n);
  assert.equal(m.regions[0].length, 0x100000n);
});

test('output sections: address, size and load address, on one line or with a long name on its own line', () => {
  const m = parseMap(gnuMap({ body: [out('.text', 0x08000000, 0x120), out('.data', 0x20000000, 0x10, 0x08000120), out('._user_heap_stack', 0x20000010, 0x600), '.empty_section', ' *(.empty*)'] }));
  assert.deepEqual(m.sections.map((s) => [s.name, s.vma, s.size, s.lma]), [['.text', 0x08000000n, 0x120, null], ['.data', 0x20000000n, 0x10, 0x08000120n], ['._user_heap_stack', 0x20000010n, 0x600, null], ['.empty_section', null, 0, null]]);
  assert.equal(m.counts.unparsed, 0);
});

test('input sections: name, address, size and object file, long names on their own line, fill, COMMON and archive members', () => {
  const m = parseMap(gnuMap({
    body: [
      out('.text', 0x08000000, 0x200),
      ' *(.text*)',
      inp('.text', 0x08000000, 0x40, '/opt/tc/crtbegin.o'),
      inp('.text.a_function_with_a_long_name', 0x08000040, 0x3e, 'build/main.o'),
      inp('*fill*', 0x0800007e, 0x2),
      inp('.text.memcpy', 0x08000080, 0x80, '/opt/tc/lib/libc_nano.a(lib_a-memcpy.o)'),
      '                                 0x84 (size before relaxing)',
      inp('LONG', 0x08000100, 0x4, '0x12345678'),
      inp('COMMON', 0x08000104, 0xfc, 'build/with space/x.o'),
      ' KEEP (*(.init))',
      ' FILL mask 0xff'
    ]
  }));
  const inputs = m.sections[0].inputs.map((i) => [i.name, i.address, i.size, i.file, i.kind]);
  assert.deepEqual(inputs, [
    ['.text', 0x08000000n, 0x40, '/opt/tc/crtbegin.o', 'input'],
    ['.text.a_function_with_a_long_name', 0x08000040n, 0x3e, 'build/main.o', 'input'],
    ['*fill*', 0x0800007en, 0x2, null, 'fill'],
    ['.text.memcpy', 0x08000080n, 0x80, '/opt/tc/lib/libc_nano.a(lib_a-memcpy.o)', 'input'],
    ['LONG', 0x08000100n, 0x4, null, 'data'],
    ['COMMON', 0x08000104n, 0xfc, 'build/with space/x.o', 'input']
  ]);
  assert.equal(m.inputSections, 6);
  assert.equal(m.counts.unparsed, 0);
});

test('symbols and assignments: plain symbols, assignments, PROVIDE and [!provide], with the section they are in', () => {
  const m = parseMap(gnuMap({
    body: [
      sym(0x20005000, '_estack = (ORIGIN (RAM) + LENGTH (RAM))'),
      out('.bss', 0x20000000, 0x10),
      sym(0x20000000, '_sbss = .'),
      inp('.bss', 0x20000000, 0x10, 'main.o'),
      sym(0x20000000, 'counter'),
      sym('[!provide]', 'PROVIDE (end = .)'),
      sym(0x20000010, '. = (. + _Min_Stack_Size)'),
      '                [0x0000000c]                foo = (foo + 0x8)'
    ]
  }));
  assert.deepEqual(m.symbols.map((s) => [s.name, s.value, s.section]), [['counter', 0x20000000n, '.bss']]);
  assert.deepEqual(m.assignments.map((a) => [a.name, a.value, a.provide, a.section]), [['_estack', 0x20005000n, false, null], ['_sbss', 0x20000000n, false, '.bss'], ['end', null, true, '.bss'], ['.', 0x20000010n, false, '.bss'], ['foo', 0xcn, false, '.bss']]);
  assert.equal(m.assignments[3].expr, '(. + _Min_Stack_Size)');
});

test('parts of the map that are not used are skipped and counted, never read as sections', () => {
  const pre = ['Discarded input sections', '', inp('.text', 0, 0x40, 'unused.o'), '', 'Allocating common symbols', 'Common symbol       size              file', '', 'buffer              0x100             main.o', ''];
  const text = gnuMap({ pre, body: [out('.text', 0x08000000, 0x10), inp('.text', 0x08000000, 0x10, 'main.o'), '', 'Cross Reference Table', '', 'Symbol                                            File', 'main                                              main.o'] });
  const m = parseMap(text);
  assert.equal(m.sections.length, 1);
  assert.equal(m.inputSections, 1);
  assert.equal(m.counts.skipped, 2 + 3 + 3, "archive members, discarded and common symbols, and the cross reference table up to the end");
  assert.equal(m.counts.unparsed, 0);
  assert.equal(m.counts.read + m.counts.skipped + m.counts.blank + m.counts.unparsed, m.lines);
});

test('lines in no known form are counted as not parsed, with their line numbers, and do not stop the reader', () => {
  const m = parseMap(gnuMap({ body: [out('.text', 0x08000000, 0x10), '   something odd here', inp('.text', 0x08000000, 0x10, 'main.o'), 'odd line at column zero'] }));
  assert.equal(m.counts.unparsed, 2);
  assert.deepEqual(m.unparsed.map((u) => u.line), [17, 19]);
  assert.equal(m.sections[0].inputs.length, 1);
});

test('the example maps read with no line left over, with LF and with CRLF line ends alike', async () => {
  for (const name of ['thermostat.map', 'thermostat-fixed.map', 'thermostat-next.map']) {
    const lf = await example(name);
    assert.ok(!lf.includes('\r'), `${name} is stored with LF line ends`);
    const a = parseMap(lf);
    const b = parseMap(lf.split('\n').join('\r\n'));
    assert.equal(a.counts.unparsed, 0, name);
    assert.deepEqual(JSON.parse(JSON.stringify(b, (k, v) => (typeof v === 'bigint' ? v.toString() : v))), JSON.parse(JSON.stringify(a, (k, v) => (typeof v === 'bigint' ? v.toString() : v))), name);
    assert.equal(a.counts.read + a.counts.skipped + a.counts.blank + a.counts.unparsed, a.lines);
  }
});

test('readMap: the format, and the model only for a GNU ld map', async () => {
  const lld = readMap(await example('thermostat-lld.map'));
  assert.equal(lld.format.kind, 'lld');
  assert.equal(lld.model, null);
  assert.equal(readMap(gnuMap()).format.kind, 'gnu-ld');
});

test('sizes and limits: decimal, hexadecimal, K and M, percents, and what is refused', () => {
  assert.equal(parseSize('480K'), 491520);
  assert.equal(parseSize('0x78000'), 0x78000);
  assert.equal(parseSize('1M'), 1048576);
  assert.equal(parseSize('1024'), 1024);
  assert.equal(parseSize('1.5K'), null);
  assert.equal(parseSize('-1'), null);
  assert.equal(parseSize('K'), null);
  assert.equal(parseSize('99999999999999999'), null);
  assert.deepEqual(parseLimit('25%'), { percent: 25 });
  assert.deepEqual(parseLimit('0.5%'), { percent: 0.5 });
  assert.deepEqual(parseLimit('16K'), { bytes: 16384 });
  assert.equal(parseLimit('101%'), null);
  assert.equal(parseLimit('abc'), null);
  assert.equal(limitBytes({ percent: 25 }, 65536), 16384);
  assert.equal(limitBytes({ percent: 1 }, 20480), 204);
  assert.equal(limitBytes({ bytes: 100 }, 65536), 100);
  assert.equal(limitText({ percent: 1 }), '1%');
  assert.equal(limitText({ bytes: 4096 }), '4,096 bytes');
  assert.equal(bytesText(1), '1 byte');
  assert.equal(grouped(66124), '66,124');
  assert.equal(hex(0x08000000n), '0x08000000');
  assert.equal(hex(0x80000000n), '0x80000000');
  assert.equal(hex(0x100000000n), '0x0000000100000000');
  assert.equal(percentText(66124, 65536), '100.9%');
  assert.equal(percentText(1, 0), 'over');
});
