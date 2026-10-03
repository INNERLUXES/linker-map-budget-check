// Shared test helpers: map files built inline in the layout GNU ld writes, and files written into a temporary folder
// that is removed after the test. Paths are built with resolve() from forward-slash names, so the same test runs on
// Linux, macOS and Windows.

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { checkText, main } from '../src/index.js';

export async function withFiles(files, fn) {
  const dir = await mkdtemp(resolve(tmpdir(), 'linker-map-budget-check-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(resolve(dir, rel)), { recursive: true });
      await writeFile(resolve(dir, rel), content);
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const h8 = (n) => `0x${BigInt(n).toString(16).padStart(8, '0')}`;
const w = (n) => `0x${n.toString(16)}`.padStart(10);

// One line of the Memory Configuration table.
export const region = (name, origin, length, attr = '') => `${name.padEnd(16)} ${h8(origin).padEnd(18)} ${h8(length).padEnd(18)} ${attr}`.trimEnd();

// An output section line, with the name on its own line when it is long, as ld writes it.
export function out(name, vma, size, lma) {
  const head = name.length >= 15 ? `${name}\n${' '.repeat(16)}` : name.padEnd(16);
  return `${head}${h8(vma)} ${w(size)}${lma !== undefined ? ` load address ${h8(lma)}` : ''}`;
}

// An input section line.
export function inp(name, addr, size, file) {
  const n = ` ${name}`;
  const head = n.length >= 15 ? `${n}\n${' '.repeat(16)}` : n.padEnd(16);
  return `${head}${h8(addr)} ${w(size)}${file ? ` ${file}` : ''}`;
}

// A symbol or assignment line.
export const sym = (addr, text) => `${' '.repeat(16)}${typeof addr === 'string' ? addr.padEnd(10) : h8(addr)}${' '.repeat(16)}${text}`;

// A whole map: the archive part, the Memory Configuration table and the memory map with these lines.
export function gnuMap({ regions = [region('FLASH', 0x08000000, 0x10000, 'xr'), region('RAM', 0x20000000, 0x5000, 'xrw')], body = [], pre = [] } = {}) {
  return [
    'Archive member included to satisfy reference by file (symbol)',
    '',
    '/opt/tc/libc.a(lib_a-memcpy.o)',
    '                              main.o (memcpy)',
    '',
    ...pre,
    'Memory Configuration',
    '',
    'Name             Origin             Length             Attributes',
    ...regions,
    `${'*default*'.padEnd(16)} 0x00000000         0xffffffff`,
    '',
    'Linker script and memory map',
    '',
    'LOAD main.o',
    ...body,
    'OUTPUT(app.elf elf32-littlearm)',
    ''
  ].join('\n');
}

// A small firmware with a stack and heap reserve: text and rodata in FLASH, data in RAM loaded from FLASH, bss.
export function firmware({ text = 0x1000, data = 0x40, bss = 0x400, stack = true, extra = [] } = {}) {
  const dataLma = 0x08000000 + text;
  return gnuMap({
    body: [
      sym(0x20005000, '_estack = (ORIGIN (RAM) + LENGTH (RAM))'),
      sym(0x400, '_Min_Stack_Size = 0x400'),
      '',
      out('.text', 0x08000000, text),
      ' *(.text*)',
      inp('.text.main', 0x08000000, text, 'main.o'),
      sym(0x08000000, 'main'),
      '',
      out('.data', 0x20000000, data, dataLma),
      inp('.data', 0x20000000, data, 'main.o'),
      '',
      out('.bss', 0x20000000 + data, bss),
      inp('.bss', 0x20000000 + data, bss, 'main.o'),
      ...(stack ? ['', out('.stack', 0x20000000 + data + bss, 0x400), sym(0x20000000 + data + bss + 0x400, '. = (. + _Min_Stack_Size)')] : []),
      ...extra,
      ''
    ]
  });
}

// Checks a map given as text.
export function check(text, options = {}) {
  return checkText(text, { path: 'firmware.map', ...options });
}

export const ids = (report) => report.findings.map((f) => f.id);
export const find = (report, id) => report.findings.filter((f) => f.id === id);
// The finding ids without the info findings that every map with objects has.
export const problems = (report) => ids(report).filter((id) => id !== 'top-objects' && id !== 'data-counted-twice');

// Writes the files and runs the command line with these arguments (paths relative to the folder).
export async function run(files, args = [], limits) {
  return withFiles(files, async (dir) => {
    let out = '';
    let err = '';
    const code = await main(args, { out: (t) => { out += t; }, err: (t) => { err += t; } }, limits, dir);
    return { code, out, err };
  });
}

// Runs the command line with exactly these arguments.
export async function cli(argv) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => { err += t; } });
  return { code, out, err };
}
