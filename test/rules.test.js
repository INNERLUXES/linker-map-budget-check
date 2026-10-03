import { test } from 'node:test';
import assert from 'node:assert/strict';
import { objectName, isNotAllocated, isZeroInit } from '../src/index.js';
import { check, find, firmware, gnuMap, ids, inp, out, problems, region, sym } from './helpers.js';

// Each check with a map small enough to work out by hand, and a near miss that must not match. The firmware() map holds
// .text in FLASH, .data in RAM loaded from FLASH, .bss, and a stack reserve; FLASH holds text + data bytes.

test('a small firmware with room to spare and a stack reserve has no problem', () => {
  const r = check(firmware());
  assert.deepEqual(problems(r), []);
  assert.deepEqual(r.regions.map((g) => [g.name, g.used, g.run, g.load, g.budget]), [['FLASH', 0x1040, 0x1000, 0x40, 0x10000], ['RAM', 0x840, 0x840, 0, 0x5000]]);
  assert.equal(r.gate.pass, true);
});

test('region-over-budget: a region that holds more than its length is an error; a region that is exactly full is not', () => {
  const over = check(firmware({ text: 0x10000 }));
  const f = find(over, 'region-over-budget');
  assert.equal(f.length, 1);
  assert.equal(f[0].subject, 'FLASH');
  assert.equal(f[0].line, 9);
  assert.match(f[0].message, /holds 65,600 bytes, more than its length of 65,536 bytes: 64 bytes too many \(100\.1%\)/);
  assert.match(f[0].message, /the output section \.text \(65,536 bytes\) and the load image of \.data \(64 bytes\)/);
  assert.match(f[0].message, /ends at 0x08010040, 64 bytes past the end of the region at 0x08010000/);
  assert.match(f[0].fix, /main\.o \(65,600 bytes\)/, 'an object counts in FLASH with its code and the load image of its data');
  assert.equal(over.gate.pass, false);
  const full = check(firmware({ text: 0x10000 - 0x40 }));
  assert.deepEqual(find(full, 'region-over-budget'), []);
  assert.equal(find(full, 'region-near-full').length, 1);
});

test('region-over-budget: --budget sets a lower limit in bytes or as a percent; an unknown region and a budget above the length are notes', () => {
  const bytes = check(firmware(), { budgets: [{ region: 'FLASH', limit: { bytes: 4096 } }] });
  assert.match(find(bytes, 'region-over-budget')[0].message, /more than the budget of 4,096 bytes given with --budget \(4,096 bytes; the region is 65,536 bytes\): 64 bytes too many/);
  const percent = check(firmware(), { budgets: [{ region: 'ram', limit: { percent: 10 } }] });
  assert.equal(find(percent, 'region-over-budget')[0].subject, 'RAM', 'the region name is matched without regard to case when it is not ambiguous');
  assert.equal(percent.regions[1].budget, 0x800);
  const unknown = check(firmware(), { budgets: [{ region: 'SRAM2', limit: { bytes: 10 } }] });
  assert.deepEqual(problems(unknown), []);
  assert.ok(unknown.notes.some((n) => n === '--budget names "SRAM2", which is not a region of the map'));
  const above = check(firmware(), { budgets: [{ region: 'FLASH', limit: { bytes: 0x20000 } }] });
  assert.equal(above.regions[0].budget, 0x10000);
  assert.ok(above.notes.some((n) => /The budget for "FLASH" is larger than the region/.test(n)));
});

test('region-near-full: above the warning level is a warning; exactly at the level is not; --warn-percent moves it', () => {
  // RAM is 20,480 bytes; 90% is 18,432. data 0x40 + stack 0x400 + bss.
  const at = check(firmware({ bss: 18432 - 0x40 - 0x400 }));
  assert.deepEqual(find(at, 'region-near-full'), []);
  const above = check(firmware({ bss: 18432 - 0x40 - 0x400 + 4 }));
  const f = find(above, 'region-near-full');
  assert.equal(f.length, 1);
  assert.match(f[0].message, /holds 18,436 bytes of its length of 20,480 bytes \(90\.0%\), above the warning level of 90%\. 2,044 bytes are free/);
  assert.equal(find(check(firmware(), { warnPercent: 5 }), 'region-near-full').length, 2);
});

test('data-counted-twice: initialised data counts in the region it runs in and the one it is loaded from; zero-filled sections never take load space', () => {
  const r = check(firmware());
  const f = find(r, 'data-counted-twice');
  assert.equal(f.length, 1);
  assert.equal(f[0].subject, '.data');
  assert.match(f[0].message, /runs in "RAM" at 0x20000000 and is loaded from "FLASH" at 0x08001000/);
  const bss = check(gnuMap({ body: [out('.bss', 0x20000000, 0x100, 0x08000000), inp('.bss', 0x20000000, 0x100, 'main.o'), out('.noinit', 0x20000100, 0x80, 0x08000100), out('.text', 0x08000000, 0x10)] }));
  assert.deepEqual(find(bss, 'data-counted-twice'), []);
  assert.equal(bss.regions[0].used, 0x10);
  assert.ok(isZeroInit('._user_heap_stack') && isZeroInit('.bss.foo') && isZeroInit('COMMON') && !isZeroInit('.data'));
});

test('no-stack-reserve: no stack section and no step by a stack size is a warning that says what was looked for and what was found', () => {
  const r = check(firmware({ stack: false }));
  const f = find(r, 'no-stack-reserve');
  assert.equal(f.length, 1);
  assert.match(f[0].message, /looked for an output section with "stack" in its name and a size above zero, or a step of the location counter by _Min_Stack_Size, __stack_size__, __STACK_SIZE, __stack_size and 5 more/);
  assert.match(f[0].message, /It found _estack = 0x20005000 \(line 16\), which says where the stack is, not how much room it gets\./);
  assert.match(f[0].message, /It found _Min_Stack_Size = 0x00000400 \(line 17\), which no section uses to set space aside\./);
  assert.equal(f[0].line, 16);
  const bare = check(gnuMap({ body: [out('.text', 0x08000000, 0x10), inp('.text', 0x08000000, 0x10, 'main.o')] }));
  assert.doesNotMatch(find(bare, 'no-stack-reserve')[0].message, /It found/);
});

test('no-stack-reserve: a stack section with a size, or a CMSIS .stack_dummy section, is a reserve; one of size zero is not', () => {
  const stackSection = (name, size) => check(gnuMap({ body: [out('.text', 0x08000000, 0x10), out(name, 0x20000000, size), sym(0x20000000 + size, '__StackLimit = .')] }));
  assert.deepEqual(find(stackSection('.stack', 0x800), 'no-stack-reserve'), []);
  assert.deepEqual(find(stackSection('.stack_dummy', 0x400), 'no-stack-reserve'), []);
  const zero = find(stackSection('.stack_dummy', 0), 'no-stack-reserve');
  assert.equal(zero.length, 1);
  assert.match(zero[0].message, /the section \.stack_dummy \(size 0\)/);
  assert.match(zero[0].message, /__StackLimit = 0x20000000/);
});

test('no-heap-reserve: malloc or _sbrk linked with no heap reserve is a warning; a heap reserve or no malloc at all is not', () => {
  const sbrk = ['', out('.text2', 0x08002000, 0x6c), inp('.text._sbrk', 0x08002000, 0x6c, 'syscalls.o')];
  const r = check(firmware({ extra: sbrk }));
  const f = find(r, 'no-heap-reserve');
  assert.equal(f.length, 1);
  assert.match(f[0].message, /the map holds _sbrk \(line \d+\)/);
  const withHeap = check(firmware({ extra: [...sbrk, '', out('.heap', 0x20004000, 0x200)] }));
  assert.deepEqual(find(withHeap, 'no-heap-reserve'), []);
  const stepped = check(firmware({ extra: [...sbrk, '', out('.reserve', 0x20004000, 0x200), sym(0x20004200, '. = (. + _Min_Heap_Size)')] }));
  assert.deepEqual(find(stepped, 'no-heap-reserve'), []);
  const none = check(firmware());
  assert.deepEqual(find(none, 'no-heap-reserve'), []);
  assert.ok(none.notes.some((n) => /no heap reserve was looked for/.test(n)));
  const bySymbol = check(firmware({ extra: ['', out('.text3', 0x08003000, 0x10), inp('.text', 0x08003000, 0x10, 'alloc.o'), sym(0x08003000, 'malloc')] }));
  assert.equal(find(bySymbol, 'no-heap-reserve').length, 1);
});

test('orphan-section: a section with code or data outside every region is a warning; empty, debugging and spilled sections are not', () => {
  const r = check(firmware({ extra: ['', out('.ccmram', 0x10000000, 0x800), inp('.ccmram', 0x10000000, 0x800, 'sensor.o'), '', out('.empty', 0x30000000, 0), '', out('.debug_info', 0, 0x9000), out('.comment', 0, 0x40)] }));
  const f = find(r, 'orphan-section');
  assert.deepEqual(f.map((x) => x.subject), ['.ccmram']);
  assert.match(f[0].message, /2,048 bytes at 0x10000000\) lies outside every region of the Memory Configuration table \(FLASH and RAM\)/);
  assert.ok(r.notes.some((n) => /2 output sections hold no code or data for the target and were not counted: \.debug_info and \.comment/.test(n)));
  assert.ok(isNotAllocated('.debug_line') && isNotAllocated('.ARM.attributes') && !isNotAllocated('.data'));
});

test('debugging sections at address 0 are not counted, also when a region starts at 0', () => {
  const r = check(gnuMap({ regions: [region('flash', 0, 0x8000, 'rx'), region('ram', 0x20000000, 0x1000, 'rw')], body: [out('.text', 0, 0x100), inp('.text', 0, 0x100, 'main.o'), out('.debug_info', 0, 0x9000), inp('.debug_info', 0, 0x9000, 'main.o'), out('.stack', 0x20000000, 0x100)] }));
  assert.equal(r.regions[0].used, 0x100);
  assert.deepEqual(problems(r), []);
});

test('a section that the linker placed right after the end of a full region counts in that region, not as an orphan', () => {
  const body = [out('.text', 0x08000000, 0x10010), inp('.text', 0x08000000, 0x10010, 'main.o'), out('.ARM.exidx', 0x08010010, 0x8), inp('.ARM.exidx', 0x08010010, 0x8, 'libgcc.a(_udivmoddi4.o)'), out('.stack', 0x20000000, 0x400)];
  const r = check(gnuMap({ body }));
  assert.deepEqual(find(r, 'orphan-section'), []);
  assert.equal(r.regions[0].used, 0x10018);
  assert.ok(r.notes.some((n) => /\.ARM\.exidx \(FLASH\) starts past the end of a full region/.test(n)));
  // The same section after a region that is not full lies outside every region.
  const notFull = check(gnuMap({ body: [out('.text', 0x08000000, 0x100), out('.ARM.exidx', 0x08010010, 0x8), out('.stack', 0x20000000, 0x400)] }));
  assert.deepEqual(find(notFull, 'orphan-section').map((f) => f.subject), ['.ARM.exidx']);
});

test('large-input-section: an object above the share of a region, or above a size, is a warning; the archive member says so', () => {
  const body = [out('.text', 0x08000000, 0x5000), inp('.rodata.font', 0x08000000, 0x4400, 'font.o'), inp('.text.printf', 0x08004400, 0xc00, '/opt/tc/libc_nano.a(lib_a-vfprintf.o)'), out('.stack', 0x20000000, 0x400)];
  const r = check(gnuMap({ body }));
  const f = find(r, 'large-input-section');
  assert.deepEqual(f.map((x) => x.subject), ['font.o']);
  assert.match(f[0].message, /font\.o takes 17,408 bytes of "FLASH" \(26\.6% of 65,536 bytes\), more than the limit of 16,384 bytes \(25% of 65,536 bytes, --max-object\)\. Its largest input section is \.rodata\.font/);
  const bytes = check(gnuMap({ body }), { maxObject: { bytes: 0x800 } });
  const g = find(bytes, 'large-input-section');
  assert.deepEqual(g.map((x) => x.subject), ['font.o', 'libc_nano.a(lib_a-vfprintf.o)']);
  assert.match(g[1].message, /member of the archive libc_nano\.a/);
  assert.match(g[1].message, /\(--max-object\)/);
  const near = check(gnuMap({ body: [out('.text', 0x08000000, 0x4000), inp('.rodata.font', 0x08000000, 0x4000, 'font.o'), out('.stack', 0x20000000, 0x400)] }));
  assert.deepEqual(find(near, 'large-input-section'), [], 'exactly at the limit is not above it');
});

test('top-objects: the largest objects and archives of each region, largest first, with --top', () => {
  const body = [out('.text', 0x08000000, 0x1000), inp('.text', 0x08000000, 0x100, 'a.o'), inp('.text', 0x08000100, 0x300, 'b.o'), inp('.text', 0x08000400, 0x200, '/x/libm.a(sin.o)'), inp('.text', 0x08000600, 0x200, '/x/libm.a(cos.o)'), inp('*fill*', 0x08000800, 0x4), out('.stack', 0x20000000, 0x400)];
  const r = check(gnuMap({ body }), { top: 2 });
  assert.deepEqual(r.largest[0].objects.map((o) => [o.name, o.bytes]), [['b.o', 0x300], ['libm.a(cos.o)', 0x200]]);
  assert.deepEqual(r.largest[0].archives.map((a) => [a.name, a.bytes, a.members]), [['libm.a', 0x400, 2]]);
  const f = find(r, 'top-objects');
  assert.equal(f.length, 1, 'RAM holds no object, so it has no list');
  assert.match(f[0].message, /The largest objects in "FLASH": b\.o 768 bytes \(1\.2%\) and libm\.a\(cos\.o\) 512 bytes \(0\.8%\)\. The largest archives: libm\.a 1,024 bytes in 2 members \(1\.6%\)\. Padding between input sections takes 4 bytes\./);
  assert.deepEqual(objectName('/opt/a b/libc.a(x.o)'), { name: 'libc.a(x.o)', archive: 'libc.a', archivePath: '/opt/a b/libc.a' });
  assert.deepEqual(objectName(['C:', 'tc', 'libc.a(x.o)'].join(String.fromCharCode(92))).name, 'libc.a(x.o)', 'a map written on Windows separates the folders of an archive with backslashes');
  assert.deepEqual(objectName('build/main.o'), { name: 'build/main.o', archive: null });
});

test('region-growth and object-growth: growth over the limit since the baseline, in percent of the region or in bytes; shrinking never counts', () => {
  const before = firmware({ text: 0x1000, bss: 0x400 });
  const after = firmware({ text: 0x1400, bss: 0x400, extra: ['', out('.text.new', 0x08002000, 0x300), inp('.text', 0x08002000, 0x300, 'new.o')] });
  const r = check(after, { baseline: { text: before, path: 'old.map' } });
  assert.deepEqual(r.growth.map((g) => [g.name, g.before, g.after, g.growth, g.limit]), [['FLASH', 0x1040, 0x1740, 0x700, 655], ['RAM', 0x840, 0x840, 0, 204]]);
  const rg = find(r, 'region-growth');
  assert.deepEqual(rg.map((f) => f.subject), ['FLASH']);
  assert.match(rg[0].message, /grew by 1,792 bytes since the baseline map, from 4,160 bytes to 5,952 bytes, more than the limit of 655 bytes \(1% of 65,536 bytes, --max-growth\)\. The objects that grew most: main\.o \+1,024 and new\.o \+768 \(new\)/);
  const og = find(r, 'object-growth');
  assert.deepEqual(og.map((f) => f.subject), ['main.o', 'new.o']);
  assert.match(og[1].message, /new\.o is new in "FLASH" since the baseline map and takes 768 bytes/);
  const loose = check(after, { baseline: { text: before, path: 'old.map' }, maxGrowth: { bytes: 0x800 } });
  assert.deepEqual(find(loose, 'region-growth'), []);
  const shrink = check(before, { baseline: { text: after, path: 'old.map' } });
  assert.deepEqual(problems(shrink), []);
  assert.equal(r.map.baseline, 'old.map');
  assert.equal(r.areas.find((a) => a.id === 'growth').result, 'fail');
  assert.equal(check(after).areas.find((a) => a.id === 'growth').result, 'off');
});

test('growth: a region only in one of the maps is a note, and a baseline that is not a GNU ld map is refused', () => {
  const before = gnuMap({ regions: [region('FLASH', 0x08000000, 0x10000, 'xr'), region('OLD', 0x30000000, 0x100)], body: [out('.text', 0x08000000, 0x10), out('.stack', 0x20000000, 0x10)] });
  const r = check(firmware(), { baseline: { text: before, path: 'old.map' } });
  assert.ok(r.notes.some((n) => n.startsWith('The region "RAM" is not in the baseline map')));
  assert.ok(r.notes.some((n) => n.startsWith('The region "OLD" of the baseline map is not in this map')));
  assert.throws(() => check(firmware(), { baseline: { text: 'hello\n', path: 'old.map' } }), /old\.map: the baseline is a text file with no/);
});

test('unparsed-lines: lines in no known form are info with their count and first line; a clean map has none', () => {
  const r = check(firmware({ extra: ['', 'this is not a map line', '   neither is this'] }));
  const f = find(r, 'unparsed-lines');
  assert.equal(f.length, 1);
  assert.match(f[0].message, /^2 lines of the map are in no form the tool reads, and were not used\. The first is line \d+: "this is not a map line"/);
  assert.equal(r.map.unparsed, 2);
  assert.deepEqual(find(check(firmware()), 'unparsed-lines'), []);
});

test('unknown-format: a file that is not a GNU ld map is one error, and the other areas are off', () => {
  const r = check('             VMA              LMA     Size Align Out     In      Symbol\n');
  assert.deepEqual(ids(r), ['unknown-format']);
  assert.match(r.findings[0].message, /^The file is an LLVM lld map file\. The tool reads only map files that GNU ld writes/);
  assert.deepEqual(r.areas.map((a) => a.result), ['fail', 'off', 'off', 'off', 'off', 'off']);
  assert.equal(r.gate.pass, false);
  assert.match(check('').findings[0].message, /^The file is an empty file\./);
});

test('a map with no MEMORY regions checks no budget and says so', () => {
  const r = check(gnuMap({ regions: [], body: [out('.text', 0x400000, 0x100), inp('.text', 0x400000, 0x100, 'main.o')] }));
  assert.deepEqual(r.regions, []);
  assert.ok(r.notes.some((n) => /The map declares no memory region \(only \*default\*, the whole address space\), so no budget was checked/.test(n)));
  assert.deepEqual(find(r, 'region-over-budget'), []);
});

test('/DISCARD/ input sections and the discarded part of the map are never counted', () => {
  const r = check(gnuMap({ pre: ['Discarded input sections', '', inp('.text.unused', 0, 0x9000, 'main.o'), ''], body: [out('.text', 0x08000000, 0x10), inp('.text', 0x08000000, 0x10, 'main.o'), '/DISCARD/', ' *(.ARM.exidx*)', out('.stack', 0x20000000, 0x10)] }));
  assert.equal(r.regions[0].used, 0x10);
  assert.deepEqual(problems(r), []);
});

test('the findings come in area order, by check, then by line, and the count of each severity matches', () => {
  const r = check(firmware({ text: 0x10000, stack: false, extra: ['', out('.ccmram', 0x10000000, 0x800)] }));
  const areas = r.findings.map((f) => f.area);
  assert.deepEqual(areas, [...areas].sort((a, b) => ['map', 'budget', 'reserve', 'placement', 'size', 'growth'].indexOf(a) - ['map', 'budget', 'reserve', 'placement', 'size', 'growth'].indexOf(b)));
  for (const sev of ['error', 'warning', 'info']) assert.equal(r.counts[sev], r.findings.filter((f) => f.severity === sev).length);
});
