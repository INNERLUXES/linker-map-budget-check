// The checks. Each one reads the model of a GNU ld map (src/mapfile.js) and reports what the map itself shows about how
// the firmware uses its memory regions. docs/method.md gives the reason behind every finding and says what each check can
// and cannot see. Nothing here opens a file or runs a program.

import { FACTS, HEAP, HEAP_USERS, NOT_ALLOCATED_PREFIXES, STACK, ZERO_INIT_WORDS, factPage } from './data.js';
import { MAP_LIMITS } from './mapfile.js';
import { bytesText, grouped, hex, limitBytes, limitText, percentText } from './size.js';

export const SEVERITIES = ['error', 'warning', 'info'];
export const RANK = { error: 0, warning: 1, info: 2 };

// The areas a report is grouped by, in report order.
export const AREAS = [
  { id: 'map', title: 'Map file' },
  { id: 'budget', title: 'Budget' },
  { id: 'reserve', title: 'Stack and heap' },
  { id: 'placement', title: 'Placement' },
  { id: 'size', title: 'Largest objects' },
  { id: 'growth', title: 'Growth' }
];

// Every finding, in report order within an area. facts are the keys of the sentences of src/data.js that the finding
// quotes; the page of the first one is the finding's source.
export const FINDINGS = [
  { id: 'unknown-format', severity: 'error', area: 'map', what: 'The file is not a map file that GNU ld writes', facts: ['mapFile', 'linkMapInfo'] },
  { id: 'region-over-budget', severity: 'error', area: 'budget', what: 'A region holds more bytes than its length, or than the budget given for it', facts: ['tooLargeError', 'lengthBytes'] },
  { id: 'region-growth', severity: 'error', area: 'growth', what: 'A region grew more than the limit since the baseline map', facts: ['objectsMapped', 'memoryUsageUseful'] },
  { id: 'region-near-full', severity: 'warning', area: 'budget', what: 'A region is fuller than the warning level', facts: ['warnTooFull', 'memoryUsageUseful'] },
  { id: 'no-stack-reserve', severity: 'warning', area: 'reserve', what: 'The map shows no space set aside for the stack, so the linker does not count it', facts: ['allocatable', 'tooLargeError'] },
  { id: 'no-heap-reserve', severity: 'warning', area: 'reserve', what: 'malloc or sbrk is linked, and the map shows no space set aside for the heap', facts: ['allocatable', 'tooLargeError'] },
  { id: 'orphan-section', severity: 'warning', area: 'placement', what: 'An output section with code or data lies outside every declared region', facts: ['directRegion', 'orphanDefinition'] },
  { id: 'large-input-section', severity: 'warning', area: 'size', what: 'One object file or archive member takes more of a region than the limit', facts: ['objectsMapped', 'archiveMembers'] },
  { id: 'object-growth', severity: 'warning', area: 'growth', what: 'One object file grew in a region more than the limit since the baseline map', facts: ['objectsMapped'] },
  { id: 'data-counted-twice', severity: 'info', area: 'placement', what: 'Initialised data takes space in the region it is loaded from and in the region it runs in', facts: ['loadedIntoRom', 'romLmaRamVma'] },
  { id: 'top-objects', severity: 'info', area: 'size', what: 'The largest object files and archives in a region', facts: ['objectsMapped'] },
  { id: 'unparsed-lines', severity: 'info', area: 'map', what: 'Lines of the map that are in no form the tool reads', facts: ['linkMapInfo'] }
];

const BY_ID = Object.fromEntries(FINDINGS.map((f) => [f.id, f]));
export const ORDER = Object.fromEntries(FINDINGS.map((f, i) => [f.id, i]));
export const BY_ID_SEVERITY = Object.fromEntries(FINDINGS.map((f) => [f.id, f.severity]));
export const AREA_ORDER = Object.fromEntries(AREAS.map((a, i) => [a.id, i]));

export const DEFAULTS = {
  warnPercent: 90,
  maxObject: { percent: 25 },
  top: 5,
  maxGrowth: { percent: 1 }
};

// The largest gap, in bytes, between the end of what a full region holds and a section placed right after it, for that
// section to count as spilling over the end of the region (docs/method.md, region-over-budget).
export const SPILL_GAP = 4096n;

// Control characters (C0 and C1), the line and paragraph separators and the Unicode direction controls, built from
// their code points so that this file holds only ASCII.
const span = (a, b) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
const UNSAFE_CHARACTERS = new RegExp(`[${span(0, 0x1f)}${span(0x7f, 0x9f)}${[0x200e, 0x200f, 0x2028, 0x2029].map((c) => String.fromCharCode(c)).join('')}${span(0x202a, 0x202e)}${span(0x2066, 0x2069)}]`, 'g');

// Text from the input: control, line separator and direction characters replaced by a space, length capped.
export function safeText(value, max = 300) {
  const s = String(value).slice(0, max * 4).replace(UNSAFE_CHARACTERS, ' ');
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

export function meetsThreshold(severity, failOn) {
  return RANK[severity] <= RANK[failOn];
}

export const isNotAllocated = (name) => NOT_ALLOCATED_PREFIXES.some((p) => name.startsWith(p));
export const isZeroInit = (name) => {
  const n = name.toLowerCase();
  return ZERO_INIT_WORDS.some((w) => n.includes(w)) || n === 'common';
};

// The short name of an object file for a report: an archive member is shown as libc.a(member.o) without the folders of
// the archive; any other object as the map writes it.
export function objectName(file) {
  const m = /^(.{1,1000}\.a)\(([^()]{1,400})\)$/.exec(file);
  if (!m) return { name: file, archive: null };
  const base = m[1].split(/[\\/]/).at(-1);
  return { name: `${base}(${m[2]})`, archive: base, archivePath: m[1] };
}

const wordIn = (expr, word) => new RegExp(`(?:^|[^A-Za-z0-9_])${word.replace(/[$.]/g, '\\$&')}(?:$|[^A-Za-z0-9_])`).test(expr);

// The usage of every region: where each output section runs and is loaded, how many bytes each region holds, and how
// many bytes each object file takes in it. Used for the map and, the same way, for the baseline map.
export function usageOf(model, options = {}) {
  const budgets = options.budgets ?? [];
  const facts = { unknownBudgets: [], budgetAboveLength: [], notAllocated: [], notCreated: 0, placed: 0, orphans: [], empty: 0, spilled: [] };
  const regions = model.regions.map((r) => ({
    name: r.name,
    origin: r.origin,
    length: r.length,
    end: r.origin + r.length,
    attributes: r.attributes,
    line: r.line,
    lengthBytes: r.length > BigInt(2 ** 48) ? 2 ** 48 : Number(r.length),
    limit: 0,
    budgetGiven: null,
    run: 0,
    load: 0,
    reach: r.origin,
    sections: [],
    objects: new Map(),
    fill: 0
  }));
  for (const r of regions) r.limit = r.lengthBytes;
  for (const b of budgets) {
    let r = regions.find((x) => x.name === b.region);
    if (!r) {
      const same = regions.filter((x) => x.name.toLowerCase() === b.region.toLowerCase());
      r = same.length === 1 ? same[0] : null;
    }
    if (!r) {
      facts.unknownBudgets.push(b.region);
      continue;
    }
    const bytes = limitBytes(b.limit, r.lengthBytes);
    r.budgetGiven = b.limit;
    if (bytes > r.lengthBytes) facts.budgetAboveLength.push(r.name);
    r.limit = Math.min(bytes, r.lengthBytes);
  }

  // The region of an address: the region that holds it, or else a full region that the address follows directly, as a
  // section does that the linker placed past the end of a region that was too small.
  const regionAt = (address) => {
    for (const r of regions) if (address >= r.origin && address < r.end) return { region: r, spill: false };
    let best = null;
    for (const r of regions) if (r.origin <= address && (best === null || r.origin > best.origin)) best = r;
    if (best && best.reach >= best.end && address >= best.end && address <= best.reach + SPILL_GAP) return { region: best, spill: true };
    return null;
  };
  const charge = (r, s, address, how) => {
    const end = address + BigInt(s.size);
    if (end > r.reach) r.reach = end;
    if (how === 'run') r.run += s.size;
    else r.load += s.size;
    r.sections.push({ name: s.name, how, address, size: s.size, line: s.line });
    for (const input of s.inputs) {
      if (input.kind === 'fill') {
        r.fill += input.size;
        continue;
      }
      if (input.kind !== 'input' || input.size === 0) continue;
      const file = input.file ?? '(linker)';
      let o = r.objects.get(file);
      if (!o) {
        o = { file, ...objectName(file), bytes: 0, line: input.line, largest: null };
        r.objects.set(file, o);
      }
      o.bytes += input.size;
      if (!o.largest || input.size > o.largest.size) o.largest = { name: input.name, size: input.size, address: input.address, line: input.line };
    }
  };

  const placed = [];
  for (const s of model.sections) {
    if (s.discard) continue;
    if (s.vma === null) {
      facts.notCreated += 1;
      continue;
    }
    if (isNotAllocated(s.name)) {
      facts.notAllocated.push(s.name);
      continue;
    }
    const run = regionAt(s.vma);
    if (s.size === 0) {
      facts.empty += 1;
      continue;
    }
    const entry = { section: s, run: run?.region ?? null, load: null };
    if (run) {
      charge(run.region, s, s.vma, 'run');
      if (run.spill) facts.spilled.push({ section: s.name, region: run.region.name });
      facts.placed += 1;
    } else facts.orphans.push(s);
    if (s.lma !== null && s.lma !== s.vma && !isZeroInit(s.name)) {
      const load = regionAt(s.lma);
      if (load) {
        charge(load.region, s, s.lma, 'load');
        entry.load = load.region;
        if (load.spill) facts.spilled.push({ section: s.name, region: load.region.name });
      }
    }
    placed.push(entry);
  }
  for (const r of regions) r.used = r.run + r.load;
  return { regions, placed, facts };
}

// The top objects and archives of a region, largest first, then by name.
export function largestOf(region, top) {
  const objects = [...region.objects.values()].sort((a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : 1));
  const archives = new Map();
  for (const o of objects) {
    if (!o.archive) continue;
    const a = archives.get(o.archivePath) ?? { name: o.archive, path: o.archivePath, bytes: 0, members: 0 };
    a.bytes += o.bytes;
    a.members += 1;
    archives.set(o.archivePath, a);
  }
  const share = (bytes) => percentText(bytes, region.limit);
  return {
    region: region.name,
    objects: objects.slice(0, top).map((o) => ({ name: o.name, path: o.file, bytes: o.bytes, share: share(o.bytes) })),
    archives: [...archives.values()].sort((a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : 1)).slice(0, top).map((a) => ({ name: a.name, path: a.path, bytes: a.bytes, members: a.members, share: share(a.bytes) }))
  };
}

// ---- the run ----------------------------------------------------------------------------------------------------------

// options: warnPercent, budgets [{ region, limit }], maxObject, top, maxGrowth; baseline is the model of the older map.
export function runRules(model, options = {}, baseline = null, limits = MAP_LIMITS) {
  const warnPercent = options.warnPercent ?? DEFAULTS.warnPercent;
  const maxObject = options.maxObject ?? DEFAULTS.maxObject;
  const top = options.top ?? DEFAULTS.top;
  const maxGrowth = options.maxGrowth ?? DEFAULTS.maxGrowth;
  const maxListed = limits.maxListedPerFinding ?? 200;
  const found = [];
  const omitted = {};

  const basisOf = (keys) => keys.map((k) => ({ text: FACTS[k].text, section: FACTS[k].section, source: factPage(k) }));
  function add(id, place, subject, message, fix) {
    const def = BY_ID[id];
    const already = found.filter((f) => f.id === id).length;
    if (already >= maxListed) {
      omitted[id] = (omitted[id] ?? 0) + 1;
      return;
    }
    found.push({
      id,
      severity: def.severity,
      area: def.area,
      file: safeText(place.file, 400),
      where: safeText(place.where, 400),
      line: place.line,
      subject: safeText(subject, 200),
      message: safeText(message, 1200),
      fix: safeText(fix, 600),
      basis: basisOf(def.facts),
      source: factPage(def.facts[0])
    });
  }
  const file = options.file ?? 'map';
  const q = (name) => `"${safeText(name, 120)}"`;
  const join = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
  const listOf = (items, max = 8) => (items.length <= max ? join(items) : `${items.slice(0, max).join(', ')} and ${items.length - max} more`);
  const firstLine = model.headers.map ?? model.headers.memory ?? 1;
  const limitWords = (limit, region, option) => (limit.bytes !== undefined ? option : `${limit.percent}% of ${bytesText(region.limit)}, ${option}`);

  const usage = usageOf(model, options);
  const { regions, placed, facts } = usage;

  // ---- budget ----
  for (const r of regions) {
    const budgetWords = r.budgetGiven ? `the budget of ${bytesText(r.limit)} given with --budget (${limitText(r.budgetGiven)}; the region is ${bytesText(r.lengthBytes)})` : `its length of ${bytesText(r.limit)}`;
    const holds = [];
    const runNames = r.sections.filter((s) => s.how === 'run').map((s) => s.name);
    const loadNames = r.sections.filter((s) => s.how === 'load').map((s) => s.name);
    if (runNames.length) holds.push(`the output ${runNames.length === 1 ? 'section' : 'sections'} ${listOf(runNames.map((n) => safeText(n, 80)))} (${bytesText(r.run)})`);
    if (loadNames.length) holds.push(`the load ${loadNames.length === 1 ? 'image' : 'images'} of ${listOf(loadNames.map((n) => safeText(n, 80)))} (${bytesText(r.load)})`);
    const big3 = largestOf(r, 3).objects.map((o) => `${safeText(o.name, 120)} (${bytesText(o.bytes)})`);
    const place = { file, where: `region ${r.name}`, line: r.line };
    if (r.used > r.limit) {
      const past = r.reach > r.end ? ` The last byte placed in it ends at ${hex(r.reach)}, ${bytesText(Number(r.reach - r.end))} past the end of the region at ${hex(r.end)}.` : '';
      add('region-over-budget', place, r.name,
        `The region ${q(r.name)} holds ${bytesText(r.used)}, more than ${budgetWords}: ${bytesText(r.used - r.limit)} too many (${percentText(r.used, r.limit)}). It holds ${join(holds)}.${past}`,
        `Make the code or data in ${q(r.name)} smaller, starting with the largest objects${big3.length ? ` (${join(big3)})` : ''}, or move a section to another region. Raise the budget only if the part really has more room.`);
    } else if (r.limit > 0 && r.used * 100 > r.limit * warnPercent) {
      add('region-near-full', place, r.name,
        `The region ${q(r.name)} holds ${bytesText(r.used)} of ${budgetWords} (${percentText(r.used, r.limit)}), above the warning level of ${warnPercent}%. ${bytesText(r.limit - r.used)} ${r.limit - r.used === 1 ? 'is' : 'are'} free. It holds ${join(holds)}.`,
        `Plan for the next features now: find what can shrink in ${q(r.name)}${big3.length ? ` (the largest objects are ${join(big3)})` : ''}, or set a budget with --budget that keeps room for them.`);
    }
  }

  // ---- placement ----
  for (const s of facts.orphans) {
    const names = regions.map((r) => r.name);
    add('orphan-section', { file, where: `section ${s.name}`, line: s.line }, s.name,
      `The output section ${q(s.name)} (${bytesText(s.size)} at ${hex(s.vma)}) lies outside every region of the Memory Configuration table${names.length ? ` (${listOf(names.map((n) => safeText(n, 80)))})` : ''}, so the linker did not count it against a region, and this report cannot either.`,
      `Declare the memory it is meant for with the MEMORY command and place the section there with ">REGION", or move its input sections into a section that is placed in a region.`);
  }
  for (const p of placed) {
    if (!p.run || !p.load || p.run === p.load) continue;
    const s = p.section;
    add('data-counted-twice', { file, where: `section ${s.name}`, line: s.line }, s.name,
      `The output section ${q(s.name)} (${bytesText(s.size)}) runs in ${q(p.run.name)} at ${hex(s.vma)} and is loaded from ${q(p.load.name)} at ${hex(s.lma)}. Its initial values are stored in ${q(p.load.name)} and copied to ${q(p.run.name)} by the startup code, so the same ${bytesText(s.size)} count in both regions.`,
      `Nothing to fix; this is how initialised data works. To save space in both regions, make data that never changes const (it then stays in ${q(p.load.name)} only) and leave data that starts at zero uninitialised (it then goes to .bss, which takes no space in ${q(p.load.name)}).`);
  }

  // ---- stack and heap ----
  const allNames = new Map();
  for (const a of model.assignments) if (!allNames.has(a.name)) allNames.set(a.name, a);
  for (const s of model.symbols) if (!allNames.has(s.name)) allNames.set(s.name, s);
  const defined = (list) => list.filter((n) => allNames.has(n)).map((n) => allNames.get(n));
  function reserveOf(kind) {
    const sections = model.sections.filter((s) => !s.discard && s.vma !== null && !isNotAllocated(s.name) && s.name.toLowerCase().includes(kind.word));
    const withSize = sections.filter((s) => s.size > 0);
    const steps = model.assignments.filter((a) => a.section !== null && a.name === '.' && kind.sizeSymbols.some((n) => wordIn(a.expr, n)));
    return { sections, withSize, steps, sizes: defined(kind.sizeSymbols), limits: defined(kind.limitSymbols), tops: defined(kind.topSymbols), reserved: withSize.length > 0 || steps.length > 0 };
  }
  const describe = (entries) => entries.map((e) => `${safeText(e.name, 80)}${e.value !== null && e.value !== undefined ? ` = ${hex(e.value)}` : ''} (line ${e.line})`);
  const lookedFor = (kind) => `an output section with "${kind.word}" in its name and a size above zero, or a step of the location counter by ${listOf(kind.sizeSymbols, 4)} inside a section`;

  const stack = reserveOf(STACK);
  if (!stack.reserved) {
    const seen = [];
    if (stack.sections.length) seen.push(`the ${stack.sections.length === 1 ? 'section' : 'sections'} ${listOf(stack.sections.map((s) => `${safeText(s.name, 80)} (size 0)`))}`);
    if (stack.tops.length || stack.limits.length) seen.push(`${join(describe([...stack.tops, ...stack.limits]))}, which ${stack.tops.length + stack.limits.length === 1 ? 'says' : 'say'} where the stack is, not how much room it gets`);
    if (stack.sizes.length) seen.push(`${join(describe(stack.sizes))}, which no section uses to set space aside`);
    const anchor = stack.tops[0] ?? stack.limits[0] ?? stack.sizes[0] ?? null;
    add('no-stack-reserve', { file, where: 'stack', line: anchor?.line ?? stack.sections[0]?.line ?? firstLine }, 'stack',
      `The map shows no space set aside for the stack. The tool looked for ${lookedFor(STACK)}, and found none.${seen.map((x) => ` It found ${x}.`).join('')} The linker checks only what is placed in a region, so the stack is not in the totals above and can grow into the data below it with no error at link time.`,
      `Reserve the stack in the linker script: a section in RAM that steps the location counter by the stack size (for example ". = . + _Min_Stack_Size;"), so the linker counts it and stops the link when RAM is too small.`);
  }
  const heapUsers = [];
  const userSeen = new Set();
  for (const s of model.symbols) if (HEAP_USERS.includes(s.name) && !userSeen.has(s.name)) { userSeen.add(s.name); heapUsers.push({ name: s.name, line: s.line, where: null }); }
  for (const s of model.sections) {
    for (const input of s.inputs) {
      const fn = HEAP_USERS.find((u) => input.name === `.text.${u}`);
      if (fn && !userSeen.has(fn)) {
        userSeen.add(fn);
        heapUsers.push({ name: fn, line: input.line, where: input.file ? objectName(input.file).name : null });
      }
    }
  }
  const heap = reserveOf(HEAP);
  const notes = [];
  if (heapUsers.length && !heap.reserved) {
    const users = heapUsers.slice(0, 4).map((u) => `${safeText(u.name, 80)} (line ${u.line})`);
    const seen = [];
    if (heap.sections.length) seen.push(`the ${heap.sections.length === 1 ? 'section' : 'sections'} ${listOf(heap.sections.map((s) => `${safeText(s.name, 80)} (size 0)`))}`);
    if (heap.tops.length || heap.limits.length) seen.push(`${join(describe([...heap.tops, ...heap.limits]))}, which ${heap.tops.length + heap.limits.length === 1 ? 'marks' : 'mark'} where a heap starts or ends, not how much room it gets`);
    if (heap.sizes.length) seen.push(`${join(describe(heap.sizes))}, which no section uses to set space aside`);
    add('no-heap-reserve', { file, where: 'heap', line: heapUsers[0].line }, 'heap',
      `The firmware takes memory at run time: the map holds ${join(users)}. It shows no space set aside for the heap: the tool looked for ${lookedFor(HEAP)}, and found none.${seen.map((x) => ` It found ${x}.`).join('')} The heap is then not in the totals above, and malloc can run into the stack with no error at link time.`,
      `Reserve the heap in the linker script, as for the stack (for example ". = . + _Min_Heap_Size;" in a section in RAM), and let _sbrk stop at the end of that space. If the firmware should not allocate at run time, remove the calls to malloc.`);
  } else if (!heapUsers.length && !heap.reserved) {
    notes.push(`The map holds none of ${listOf(HEAP_USERS, 4)}, so the firmware does not seem to take memory from a heap, and no heap reserve was looked for`);
  }

  // ---- largest objects ----
  const largest = [];
  for (const r of regions) {
    const limit = limitBytes(maxObject, r.limit);
    for (const o of [...r.objects.values()].sort((a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : 1))) {
      if (o.bytes <= limit) break;
      const from = o.archive ? ` It is a member of the archive ${safeText(o.archive, 120)}, brought in because a symbol it defines was needed.` : '';
      const biggest = o.largest ? ` Its largest input section is ${safeText(o.largest.name, 120)} (${bytesText(o.largest.size)} at ${hex(o.largest.address)}).` : '';
      add('large-input-section', { file, where: `object ${o.name} in ${r.name}`, line: o.line }, o.name,
        `${safeText(o.name, 200)} takes ${bytesText(o.bytes)} of ${q(r.name)} (${percentText(o.bytes, r.limit)} of ${bytesText(r.limit)}), more than the limit of ${bytesText(limit)} (${limitWords(maxObject, r, '--max-object')}).${biggest}${from}`,
        `Check whether all of it is needed: a buffer or a table that could be smaller, a library function that pulls in more than it is worth (printf with floating point is a common one), or code and data that -ffunction-sections, -fdata-sections and --gc-sections would drop.`);
    }
    if (r.objects.size) {
      const l = largestOf(r, top);
      largest.push(l);
      const objs = l.objects.map((o) => `${safeText(o.name, 160)} ${bytesText(o.bytes)} (${o.share})`);
      const archs = l.archives.map((a) => `${safeText(a.name, 120)} ${bytesText(a.bytes)} in ${a.members} ${a.members === 1 ? 'member' : 'members'} (${a.share})`);
      add('top-objects', { file, where: `region ${r.name}`, line: r.line }, r.name,
        `The largest objects in ${q(r.name)}: ${join(objs)}.${archs.length ? ` The largest archives: ${join(archs)}.` : ''}${r.fill ? ` Padding between input sections takes ${bytesText(r.fill)}.` : ''}`,
        'Nothing to fix; the list shows where the bytes go. Change the length of the list with --top.');
    }
  }

  // ---- growth ----
  let growth = null;
  if (baseline) {
    const old = usageOf(baseline, options);
    growth = { regions: [] };
    for (const r of regions) {
      const o = old.regions.find((x) => x.name === r.name);
      if (!o) {
        notes.push(`The region ${q(r.name)} is not in the baseline map, so its growth was not checked`);
        continue;
      }
      const limit = limitBytes(maxGrowth, r.limit);
      const delta = r.used - o.used;
      growth.regions.push({ name: r.name, before: o.used, after: r.used, growth: delta, limit });
      const changes = [];
      for (const [key, obj] of r.objects) {
        const before = o.objects.get(key)?.bytes ?? 0;
        if (obj.bytes - before !== 0) changes.push({ obj, before, delta: obj.bytes - before, isNew: !o.objects.has(key) });
      }
      for (const [key, obj] of o.objects) if (!r.objects.has(key)) changes.push({ obj, before: obj.bytes, delta: -obj.bytes, gone: true });
      changes.sort((a, b) => b.delta - a.delta || (a.obj.name < b.obj.name ? -1 : 1));
      if (delta > limit) {
        const most = changes.filter((c) => c.delta > 0).slice(0, 3).map((c) => `${safeText(c.obj.name, 120)} +${grouped(c.delta)}${c.isNew ? ' (new)' : ''}`);
        add('region-growth', { file, where: `region ${r.name}`, line: r.line }, r.name,
          `The region ${q(r.name)} grew by ${bytesText(delta)} since the baseline map, from ${bytesText(o.used)} to ${bytesText(r.used)}, more than the limit of ${bytesText(limit)} (${limitWords(maxGrowth, r, '--max-growth')}).${most.length ? ` The objects that grew most: ${join(most)}.` : ''}`,
          `Check that the growth is meant. If it is, accept it by making this map the new baseline; if not, find the change that added it, starting with the objects named here.`);
      }
      for (const c of changes) {
        if (c.delta <= limit) break;
        const what = c.isNew
          ? `${safeText(c.obj.name, 200)} is new in ${q(r.name)} since the baseline map and takes ${bytesText(c.delta)}`
          : `${safeText(c.obj.name, 200)} grew by ${bytesText(c.delta)} in ${q(r.name)} since the baseline map, from ${bytesText(c.before)} to ${bytesText(c.obj.bytes)}`;
        add('object-growth', { file, where: `object ${c.obj.name} in ${r.name}`, line: c.obj.line }, c.obj.name,
          `${what}, more than the limit of ${bytesText(limit)} (${limitWords(maxGrowth, r, '--max-growth')}).`,
          'Check that the growth is meant: look at the change to this object, and at what it now pulls in from libraries.');
      }
    }
    for (const o of old.regions) if (!regions.some((r) => r.name === o.name)) notes.push(`The region ${q(o.name)} of the baseline map is not in this map`);
  }

  // ---- the map itself ----
  if (model.counts.unparsed) {
    const first = model.unparsed[0];
    add('unparsed-lines', { file, where: 'map', line: first.line }, 'map',
      `${grouped(model.counts.unparsed)} ${model.counts.unparsed === 1 ? 'line' : 'lines'} of the map ${model.counts.unparsed === 1 ? 'is' : 'are'} in no form the tool reads, and ${model.counts.unparsed === 1 ? 'was' : 'were'} not used. The first is line ${first.line}: "${safeText(first.text.trim(), 120)}". Lines: ${model.unparsed.slice(0, 10).map((u) => u.line).join(', ')}${model.counts.unparsed > 10 ? ', ...' : ''}.`,
      'Check that the file is a whole map written by GNU ld. If it is, the totals may miss what those lines hold; please report the line forms (with made-up names) so the reader can learn them.');
  }

  // ---- notes ----
  if (regions.length === 0) notes.push(`The map declares no memory region${model.defaultRegion ? ' (only *default*, the whole address space)' : ''}, so no budget was checked. Declare the regions of the part with the MEMORY command`);
  if (facts.unknownBudgets.length) notes.push(`--budget names ${listOf(facts.unknownBudgets.map(q))}, which ${facts.unknownBudgets.length === 1 ? 'is not a region' : 'are not regions'} of the map`);
  if (facts.budgetAboveLength.length) notes.push(`The budget for ${listOf(facts.budgetAboveLength.map(q))} is larger than the region, so the length of the region was used`);
  if (facts.notAllocated.length) notes.push(`${grouped(facts.notAllocated.length)} output ${facts.notAllocated.length === 1 ? 'section holds' : 'sections hold'} no code or data for the target and ${facts.notAllocated.length === 1 ? 'was' : 'were'} not counted: ${listOf([...new Set(facts.notAllocated)].map((n) => safeText(n, 80)))}`);
  const spilledNames = [...new Set(facts.spilled.map((s) => `${safeText(s.section, 80)} (${safeText(s.region, 80)})`))];
  if (spilledNames.length) notes.push(`${listOf(spilledNames)} ${spilledNames.length === 1 ? 'starts' : 'start'} past the end of a full region and ${spilledNames.length === 1 ? 'was' : 'were'} counted in it (docs/method.md)`);
  for (const [id, n] of Object.entries(omitted)) notes.push(`${grouped(n)} more ${n === 1 ? 'finding' : 'findings'} of ${id} ${n === 1 ? 'is' : 'are'} counted but not listed (the limit is ${maxListed} listed findings per check)`);

  found.sort((a, b) => AREA_ORDER[a.area] - AREA_ORDER[b.area] || ORDER[a.id] - ORDER[b.id] || a.line - b.line);
  return { findings: found, omitted, usage, largest, growth, notes };
}
