// Reads the text of a map file that GNU ld writes with -Map=<file> (or -Wl,-Map=<file> through gcc). The reader keeps
// what the checks need: the Memory Configuration table, the output sections of the memory map with their addresses,
// sizes and load addresses, the input sections with their object files, and the symbols and assignments. Every line is
// counted as read, skipped (a part of the map the tool does not use), blank or not parsed, so no line is dropped
// silently. docs/inputs.md lists the line forms. Nothing here opens a file or runs a program.

import { DATA_STATEMENTS, DEFAULT_REGION, DISCARD_SECTION, FILL, MAP_HEADERS, MAP_KEYWORDS, OTHER_FORMATS, REGION_TABLE_HEADER } from './data.js';
import { MAX_BYTES, grouped } from './size.js';

export const MAP_LIMITS = {
  maxLines: 2_000_000,
  maxLineLength: 4096,
  maxRegions: 256,
  maxSections: 20_000,
  maxInputSections: 500_000,
  maxSymbols: 1_000_000,
  maxUnparsedKept: 20
};

// Hexadecimal numbers of up to 16 digits. Every pattern below is anchored, its repeats are bounded or separated by
// characters of another class (\S then \s), so a long near miss is read in one pass.
const HEX = '0x([0-9a-fA-F]{1,16})';
const RE = {
  region: new RegExp(`^(\\S{1,200})\\s+${HEX}\\s+${HEX}(?:\\s+(\\S.{0,80}))?$`),
  outputFull: new RegExp(`^(\\S{1,500})\\s+${HEX}\\s+${HEX}(?:\\s+load address ${HEX})?$`),
  outputName: /^(\S{1,500})$/,
  outputCont: new RegExp(`^\\s+${HEX}\\s+${HEX}(?:\\s+load address ${HEX})?$`),
  inputFull: new RegExp(`^ (\\S{1,500})\\s+${HEX}\\s+${HEX}(?:\\s+(\\S.*))?$`),
  inputName: /^ (\S{1,500})$/,
  inputCont: new RegExp(`^\\s{2,}${HEX}\\s+${HEX}(?:\\s+(\\S.*))?$`),
  symbol: new RegExp(`^\\s{2,}(?:${HEX}|\\[${HEX}\\]|(\\[!provide\\]))\\s+(\\S.*)$`),
  relaxed: new RegExp(`^\\s{2,}${HEX} \\(size before relaxing\\)$`),
  scriptWord: /^ [A-Z][A-Z_]{1,40}(?:\s|\(|$)/,
  provide: /^(?:PROVIDE|PROVIDE_HIDDEN|HIDDEN)\s{0,4}\(\s{0,4}([^\s=()]{1,400})\s{0,4}=\s{0,4}(.*)\)$/,
  assign: /^([^\s=()]{1,400})\s{0,4}[-+*/|&]?=\s{0,4}(.*)$/
};

// The lines of a text, for \n, \r\n and a lone \r alike. A final line break does not make an empty last line.
export function splitLines(text) {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length && lines.at(-1) === '') lines.pop();
  return lines;
}

const big = (h) => BigInt(`0x${h}`);
const sizeOf = (h) => {
  const v = big(h);
  return v <= BigInt(MAX_BYTES) ? Number(v) : null;
};

// What the text is: a GNU ld map (both the Memory Configuration and the memory map headers are there), a map of another
// linker, an ELF file, another binary file, or text of no known kind.
export function detectFormat(text, lines = null) {
  const head = text.slice(0, 65536);
  if (head.startsWith('\x7fELF')) return { gnu: false, kind: 'elf', name: 'an ELF file, not its map' };
  if (head.includes('\u0000')) return { gnu: false, kind: 'binary', name: 'a binary file' };
  const all = lines ?? splitLines(text);
  let memory = false;
  let map = false;
  for (const l of all) {
    if (l.length > 100) continue;
    const t = l.trimEnd();
    if (t === MAP_HEADERS.memory) memory = true;
    else if (t === MAP_HEADERS.map) map = true;
    if (memory && map) return { gnu: true, kind: 'gnu-ld', name: 'a GNU ld map file' };
  }
  for (const l of all.slice(0, 400)) {
    const t = l.slice(0, 400);
    for (const f of OTHER_FORMATS) if (f.pattern.test(t)) return { gnu: false, kind: f.id, name: f.name };
  }
  if (all.length === 0 || all.every((l) => l.trim() === '')) return { gnu: false, kind: 'empty', name: 'an empty file' };
  const missing = [memory ? null : `"${MAP_HEADERS.memory}"`, map ? null : `"${MAP_HEADERS.map}"`].filter(Boolean).join(' and ');
  return { gnu: false, kind: 'unknown', name: `a text file with no ${missing} line` };
}

// The name and the expression of an assignment line of the memory map: "_estack = (ORIGIN (RAM) + LENGTH (RAM))",
// "PROVIDE (end = .)", ". = (. + _Min_Stack_Size)". Returns null for a line that is a symbol name only.
function assignmentOf(rest) {
  const p = RE.provide.exec(rest);
  if (p) return { name: p[1], expr: p[2].trim(), provide: true };
  if (!rest.includes('=')) return null;
  const a = RE.assign.exec(rest);
  if (a) return { name: a[1], expr: a[2].trim(), provide: false };
  return null;
}

// Reads a GNU ld map. Throws when a limit is passed; returns the model otherwise. Call detectFormat first: a text that is
// not a GNU ld map is read as unparsed lines.
export function parseMap(text, limits = MAP_LIMITS, lines = splitLines(text)) {
  if (lines.length > limits.maxLines) throw new Error(`more than ${grouped(limits.maxLines)} lines`);
  const model = {
    lines: lines.length,
    counts: { read: 0, skipped: 0, blank: 0, unparsed: 0 },
    unparsed: [],
    headers: {},
    regions: [],
    defaultRegion: null,
    sections: [],
    symbols: [],
    assignments: [],
    inputSections: 0
  };
  let state = 'start';
  let section = null;
  let pendingOut = null;
  let pendingIn = null;
  let afterOutput = false;

  const unparsed = (index, line) => {
    model.counts.unparsed += 1;
    if (model.unparsed.length < limits.maxUnparsedKept) model.unparsed.push({ line: index + 1, text: line.slice(0, 400) });
  };
  const read = () => { model.counts.read += 1; };
  const newSection = (name, line, vma, size, lma) => {
    if (model.sections.length >= limits.maxSections) throw new Error(`more than ${grouped(limits.maxSections)} output sections`);
    section = { name, line, vma, size, lma, inputs: [], symbols: [], assignments: [], discard: name === DISCARD_SECTION, afterOutput };
    model.sections.push(section);
  };
  const addInput = (name, line, address, size, file, kind) => {
    model.inputSections += 1;
    if (model.inputSections > limits.maxInputSections) throw new Error(`more than ${grouped(limits.maxInputSections)} input sections`);
    section.inputs.push({ name, line, address, size, file, kind });
  };
  // A pending name with no address on the next line: an output section that was not created, or a line of the script.
  const flush = () => {
    if (pendingOut) {
      newSection(pendingOut.name, pendingOut.line, null, 0, null);
      pendingOut = null;
    }
    if (pendingIn) pendingIn = null;
  };
  const symbolLine = (index, m) => {
    if (model.symbols.length + model.assignments.length >= limits.maxSymbols) throw new Error(`more than ${grouped(limits.maxSymbols)} symbols and assignments`);
    const value = m[1] !== undefined ? big(m[1]) : m[2] !== undefined ? big(m[2]) : null;
    const rest = m[4];
    const a = assignmentOf(rest);
    if (a) {
      const entry = { name: a.name, expr: a.expr, provide: a.provide, value, line: index + 1, section: section?.name ?? null };
      model.assignments.push(entry);
      section?.assignments.push(entry);
    } else {
      const entry = { name: rest.trim(), value, line: index + 1, section: section?.name ?? null };
      model.symbols.push(entry);
      section?.symbols.push(entry);
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.length > limits.maxLineLength) {
      flush();
      unparsed(i, raw);
      continue;
    }
    const line = raw.trimEnd();
    if (line === '') {
      flush();
      model.counts.blank += 1;
      continue;
    }
    // A header switches the part of the map that is read.
    if (line === MAP_HEADERS.memory || line === MAP_HEADERS.map || line === MAP_HEADERS.common || line === MAP_HEADERS.discarded || line === MAP_HEADERS.properties || line === MAP_HEADERS.cref || MAP_HEADERS.archive.includes(line)) {
      flush();
      section = null;
      state = line === MAP_HEADERS.memory ? 'memory' : line === MAP_HEADERS.map ? 'map' : line === MAP_HEADERS.common ? 'common' : line === MAP_HEADERS.discarded ? 'discarded' : line === MAP_HEADERS.properties ? 'properties' : line === MAP_HEADERS.cref ? 'cref' : 'archive';
      if (!model.headers[state]) model.headers[state] = i + 1;
      read();
      continue;
    }
    if (state === 'archive' || state === 'common' || state === 'discarded' || state === 'properties' || state === 'cref') {
      model.counts.skipped += 1;
      continue;
    }
    if (state === 'memory') {
      const words = line.trim().split(/\s+/);
      if (REGION_TABLE_HEADER.every((w, k) => words[k] === w)) {
        read();
        continue;
      }
      const m = RE.region.exec(line);
      if (!m) {
        unparsed(i, raw);
        continue;
      }
      read();
      const region = { name: m[1], origin: big(m[2]), length: big(m[3]), attributes: m[4] ?? '', line: i + 1 };
      if (m[1] === DEFAULT_REGION) model.defaultRegion = region;
      else {
        if (model.regions.length >= limits.maxRegions) throw new Error(`more than ${grouped(limits.maxRegions)} memory regions`);
        model.regions.push(region);
      }
      continue;
    }
    if (state !== 'map') {
      unparsed(i, raw);
      continue;
    }

    // The memory map.
    if (pendingOut) {
      const m = RE.outputCont.exec(line);
      if (m) {
        const size = sizeOf(m[2]);
        if (size === null) unparsed(i, raw);
        else {
          newSection(pendingOut.name, pendingOut.line, big(m[1]), size, m[3] !== undefined ? big(m[3]) : null);
          read();
        }
        pendingOut = null;
        continue;
      }
      flush();
    }
    if (pendingIn) {
      const m = RE.inputCont.exec(line);
      if (m) {
        const size = sizeOf(m[2]);
        if (size === null) unparsed(i, raw);
        else {
          addInput(pendingIn.name, pendingIn.line, big(m[1]), size, m[3] ?? null, pendingIn.name === FILL ? 'fill' : 'input');
          read();
        }
        pendingIn = null;
        continue;
      }
      flush();
    }
    if (line[0] !== ' ' && line[0] !== '\t') {
      if (MAP_KEYWORDS.some((k) => line.startsWith(k))) {
        if (line.startsWith('OUTPUT(')) afterOutput = true;
        section = null;
        read();
        continue;
      }
      const m = RE.outputFull.exec(line);
      if (m) {
        const size = sizeOf(m[3]);
        if (size === null) unparsed(i, raw);
        else {
          newSection(m[1], i + 1, big(m[2]), size, m[4] !== undefined ? big(m[4]) : null);
          read();
        }
        continue;
      }
      const n = RE.outputName.exec(line);
      if (n) {
        pendingOut = { name: n[1], line: i + 1 };
        read();
        continue;
      }
      unparsed(i, raw);
      continue;
    }
    if (line[0] === ' ' && line[1] !== ' ' && line[1] !== '\t') {
      const m = RE.inputFull.exec(line);
      if (m && section) {
        const size = sizeOf(m[3]);
        if (size === null) {
          unparsed(i, raw);
          continue;
        }
        const kind = m[1] === FILL ? 'fill' : DATA_STATEMENTS.includes(m[1]) ? 'data' : 'input';
        addInput(m[1], i + 1, big(m[2]), size, kind === 'input' ? (m[4] ?? null) : null, kind);
        read();
        continue;
      }
      const n = RE.inputName.exec(line);
      if (n && section && !n[1].includes('(')) {
        pendingIn = { name: n[1], line: i + 1 };
        read();
        continue;
      }
      // A line of the linker script that ld copies into the map: an input section description such as *(.text*) or
      // KEEP (*(.isr_vector)), or a keyword such as FILL.
      if (!m && (line.includes('(') || line[1] === '*' || RE.scriptWord.test(line))) {
        read();
        continue;
      }
      unparsed(i, raw);
      continue;
    }
    if (RE.relaxed.test(line)) {
      read();
      continue;
    }
    const s = RE.symbol.exec(line);
    if (s) {
      symbolLine(i, s);
      read();
      continue;
    }
    unparsed(i, raw);
  }
  flush();
  return model;
}

// Reads a text: the format, and the model when it is a GNU ld map.
export function readMap(text, limits = MAP_LIMITS) {
  const lines = splitLines(text);
  if (lines.length > limits.maxLines) throw new Error(`more than ${grouped(limits.maxLines)} lines`);
  const format = detectFormat(text, lines);
  if (!format.gnu) return { format, model: null, lines: lines.length };
  return { format, model: parseMap(text, limits, lines), lines: lines.length };
}
