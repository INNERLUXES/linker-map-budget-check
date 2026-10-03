// Reads a map file (and, for the growth checks, an older one), runs the checks of src/rules.js and returns one report:
// the regions table, the largest objects, the findings grouped by area, notes and the gate. docs/method.md gives the
// reason behind every finding. The tool reads the files it is given and opens no connection.

import { resolve } from 'node:path';
import { FILE_LIMITS, displayPath, readBounded } from './files.js';
import { MAP_LIMITS, readMap } from './mapfile.js';
import { AREAS, BY_ID_SEVERITY, DEFAULTS, FINDINGS, ORDER, RANK, SEVERITIES, meetsThreshold, runRules, safeText } from './rules.js';
import { grouped, hex, limitText, percentText } from './size.js';
import { FACTS, MAP_HEADERS, factPage } from './data.js';

export const LIMITS = { ...MAP_LIMITS, ...FILE_LIMITS, maxListedPerFinding: 200 };
export { AREAS, FINDINGS, ORDER, RANK, SEVERITIES, meetsThreshold, safeText };

function plural(count, one, many = `${one}s`) {
  return `${grouped(count)} ${count === 1 ? one : many}`;
}

// The report for a file that is not a GNU ld map: one error that says what the file looks like.
function unknownReport(path, format) {
  const basis = ['mapFile', 'linkMapInfo'].map((k) => ({ text: FACTS[k].text, section: FACTS[k].section, source: factPage(k) }));
  const finding = {
    id: 'unknown-format',
    severity: 'error',
    area: 'map',
    file: safeText(path, 400),
    where: 'map',
    line: 1,
    subject: 'map',
    message: `The file is ${format.name}. The tool reads only map files that GNU ld writes with -Map=<file> (from arm-none-eabi-gcc, riscv64-unknown-elf-gcc, avr-gcc and other GNU toolchains), which hold a "${MAP_HEADERS.memory}" table and a "${MAP_HEADERS.map}" part. Nothing else was checked.`,
    fix: 'Give the map that GNU ld writes when the firmware is linked with -Wl,-Map=firmware.map. Maps of LLVM lld, IAR and Keil are out of scope (docs/limits.md).',
    basis,
    source: basis[0].source
  };
  return finding;
}

// Builds the report for the text of a map file. options: path (shown in the report), failOn, version, warnPercent,
// budgets, maxObject, top, maxGrowth, baseline ({ text, path }) and limits.
export function checkText(text, options = {}) {
  const limits = options.limits ?? LIMITS;
  const failOn = options.failOn ?? 'error';
  const path = options.path ?? 'firmware.map';
  const warnPercent = options.warnPercent ?? DEFAULTS.warnPercent;
  const maxObject = options.maxObject ?? DEFAULTS.maxObject;
  const top = options.top ?? DEFAULTS.top;
  const maxGrowth = options.maxGrowth ?? DEFAULTS.maxGrowth;
  const budgets = options.budgets ?? [];

  let baselineModel = null;
  let baselinePath = null;
  if (options.baseline) {
    baselinePath = safeText(options.baseline.path, 400);
    const b = readMap(options.baseline.text, limits);
    if (!b.format.gnu) throw new Error(`${options.baseline.path}: the baseline is ${b.format.name}, not a map file that GNU ld writes`);
    baselineModel = b.model;
  }

  const { format, model, lines } = readMap(text, limits);
  let result;
  if (!format.gnu) {
    result = { findings: [unknownReport(path, format)], omitted: {}, usage: { regions: [], facts: null }, largest: [], growth: null, notes: [] };
  } else {
    result = runRules(model, { warnPercent, budgets, maxObject, top, maxGrowth, file: path }, baselineModel, limits);
  }
  const { findings, omitted, usage, largest, growth, notes } = result;

  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  for (const [id, n] of Object.entries(omitted)) counts[BY_ID_SEVERITY[id]] += n;

  const areas = AREAS.map((a) => {
    const own = findings.filter((f) => f.area === a.id);
    const worst = own.length ? own.reduce((w, f) => (RANK[f.severity] < RANK[w] ? f.severity : w), 'info') : null;
    let result = worst === 'error' ? 'fail' : worst === 'warning' ? 'warn' : worst === 'info' ? 'info' : 'pass';
    let detail = own.length ? [...new Set(own.map((f) => f.id))].map((id) => `${id} x${own.filter((f) => f.id === id).length + (omitted[id] ?? 0)}`).join(', ') : 'no finding';
    if (a.id === 'growth' && !baselineModel) {
      result = 'off';
      detail = 'no --baseline given';
    } else if (!format.gnu && a.id !== 'map') {
      result = 'off';
      detail = 'not a GNU ld map';
    }
    return { id: a.id, title: a.title, result, detail: safeText(detail, 400), findings: own.length };
  });

  const regions = usage.regions.map((r) => ({
    name: safeText(r.name, 80),
    origin: hex(r.origin),
    length: r.lengthBytes,
    budget: r.limit,
    used: r.used,
    run: r.run,
    load: r.load,
    free: r.limit - r.used,
    percent: percentText(r.used, r.limit),
    attributes: safeText(r.attributes, 40),
    line: r.line
  }));
  const f = usage.facts;
  const objects = new Set();
  if (model) for (const s of model.sections) for (const i of s.inputs) if (i.kind === 'input' && i.file) objects.add(i.file);

  const eCount = meetsThreshold('error', failOn) ? counts.error : 0;
  const wCount = meetsThreshold('warning', failOn) ? counts.warning : 0;
  const reason = [eCount ? plural(eCount, 'error') : null, wCount ? plural(wCount, 'warning') : null].filter(Boolean).join(', ');

  return {
    tool: 'linker-map-budget-check',
    version: options.version ?? '0.0.0',
    map: {
      file: safeText(path, 400),
      baseline: baselinePath,
      format: format.kind,
      lines: model ? model.lines : lines,
      read: model ? model.counts.read : 0,
      skipped: model ? model.counts.skipped : 0,
      blank: model ? model.counts.blank : 0,
      unparsed: model ? model.counts.unparsed : 0,
      regions: regions.length,
      outputSections: f ? { inRegion: f.placed, outsideRegions: f.orphans.length, notAllocated: f.notAllocated.length, empty: f.empty + f.notCreated } : null,
      inputSections: model ? model.inputSections : 0,
      objects: objects.size,
      symbols: model ? model.symbols.length + model.assignments.length : 0,
      warnPercent,
      maxObject: limitText(maxObject),
      top,
      maxGrowth: baselineModel ? limitText(maxGrowth) : null
    },
    areas,
    regions,
    largest,
    growth: growth ? growth.regions.map((g) => ({ ...g, name: safeText(g.name, 80) })) : null,
    findings,
    notes: notes.map((n) => safeText(n, 1200)),
    counts,
    gate: { failOn, pass: eCount + wCount === 0, reason }
  };
}

// Reads the map (and the baseline map) and builds the report. The paths in the report are relative to base, with
// forward slashes.
export async function checkFile(path, options = {}) {
  const base = options.base ?? process.cwd();
  const limits = options.limits ?? LIMITS;
  const readText = async (file) => {
    const full = resolve(base, file);
    const shown = displayPath(full, base);
    try {
      return { text: (await readBounded(full, limits.maxFileBytes)).toString('utf8'), path: shown };
    } catch (error) {
      throw new Error(`${shown}: ${error.reason ?? error.message}`);
    }
  };
  const map = await readText(path);
  const baseline = options.baselinePath ? await readText(options.baselinePath) : null;
  return checkText(map.text, { ...options, path: map.path, baseline, limits });
}

