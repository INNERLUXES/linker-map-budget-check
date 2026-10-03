// Command line: linker-map-budget-check <map-file> [options]

import { readFileSync } from 'node:fs';
import { FINDINGS, LIMITS, checkFile, safeText } from './check.js';
import { toText, toMarkdown, toJson, toCsv } from './report.js';
import { DEFAULTS } from './rules.js';
import { limitText, parseLimit } from './size.js';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const FORMATS = { text: toText, markdown: toMarkdown, json: toJson, csv: toCsv };
const THRESHOLDS = ['error', 'warning'];

export const USAGE = `Usage: linker-map-budget-check <map-file> [options]

Reads a map file that GNU ld writes with -Map=<file> (arm-none-eabi-gcc, riscv64-unknown-elf-gcc, avr-gcc and other GNU
toolchains, through -Wl,-Map=firmware.map) and reports how the firmware uses its flash and RAM: regions over budget
or nearly full, initialised data that counts in flash and RAM, a stack or heap that the linker does not count, output
sections outside every region, the largest objects and archives, and growth against an older map. It opens no
network connection and runs no program.

Options:
  --format <name>           text, markdown, json or csv (default: text)
  --fail-on <level>         exit with 1 when a finding is at this level or above: error or warning
                            (default: error); info never fails the run
  --warn-percent <n>        a region above this percent of its budget is nearly full (default: ${DEFAULTS.warnPercent})
  --budget <region>=<size>  a budget below the length of a region, in bytes (480K, 0x78000, 1M) or as a
                            percent of the region (75%); may be given once per region
  --max-object <limit>      the most one object file may take of a region, in bytes or as a percent of the
                            region's budget (default: ${limitText(DEFAULTS.maxObject)})
  --top <n>                 how many of the largest objects and archives to list per region (default: ${DEFAULTS.top})
  --baseline <map-file>     an older map of the same firmware, for the growth checks
  --max-growth <limit>      the most a region or an object may grow since the baseline, in bytes or as a
                            percent of the region's budget (default: ${limitText(DEFAULTS.maxGrowth)})
  --help                    show this text
  --version                 show the version

Checks: ${FINDINGS.map((f) => f.id).join(', ')}

Exit codes: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
`;

const isUrl = (f) => /^[a-z][a-z0-9+.-]*:\/\//i.test(f);

export function parseArgs(argv) {
  const o = { file: null, format: 'text', failOn: 'error', warnPercent: DEFAULTS.warnPercent, budgets: [], maxObject: DEFAULTS.maxObject, top: DEFAULTS.top, baseline: null, maxGrowth: DEFAULTS.maxGrowth, maxGrowthGiven: false, help: false, version: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--format') o.format = next();
    else if (a === '--fail-on') o.failOn = next();
    else if (a === '--warn-percent') {
      const v = next();
      if (!/^[0-9]{1,3}(?:\.[0-9]{1,2})?$/.test(v) || Number(v) < 1 || Number(v) > 100) throw new Error(`--warn-percent takes a number from 1 to 100, not ${v.slice(0, 20)}`);
      o.warnPercent = Number(v);
    } else if (a === '--budget') {
      const v = next();
      const m = /^([^=\s]{1,200})=(.{1,40})$/.exec(v);
      const limit = m ? parseLimit(m[2]) : null;
      if (!m || !limit || (limit.bytes ?? limit.percent) <= 0) throw new Error(`--budget takes <region>=<size>, such as FLASH=480K, FLASH=0x78000 or RAM=75%, not ${v.slice(0, 40)}`);
      if (o.budgets.some((b) => b.region === m[1])) throw new Error(`--budget is given twice for ${m[1]}`);
      if (o.budgets.length >= 100) throw new Error('--budget is given more than 100 times');
      o.budgets.push({ region: m[1], limit });
    } else if (a === '--max-object') {
      const v = next();
      const limit = parseLimit(v);
      if (!limit || (limit.bytes ?? limit.percent) <= 0) throw new Error(`--max-object takes a size (16K, 0x4000) or a percent (25%), not ${v.slice(0, 20)}`);
      o.maxObject = limit;
    } else if (a === '--top') {
      const v = next();
      if (!/^[0-9]{1,3}$/.test(v) || Number(v) < 1 || Number(v) > 100) throw new Error(`--top takes a whole number from 1 to 100, not ${v.slice(0, 20)}`);
      o.top = Number(v);
    } else if (a === '--baseline') {
      if (o.baseline !== null) throw new Error('--baseline is given twice');
      o.baseline = next();
    } else if (a === '--max-growth') {
      const v = next();
      const limit = parseLimit(v);
      if (!limit) throw new Error(`--max-growth takes a size (2K, 0x800) or a percent (1%), not ${v.slice(0, 20)}`);
      o.maxGrowth = limit;
      o.maxGrowthGiven = true;
    } else if (a === '-') throw new Error('reading from standard input is not supported; give the path of the map file');
    else if (a.startsWith('-')) throw new Error(`unknown argument ${a}`);
    else if (o.file !== null) throw new Error('give one map file; give an older map with --baseline');
    else o.file = a;
  }
  if (!o.help && !o.version) {
    if (o.file === null) throw new Error('give the path of a map file');
    if (isUrl(o.file) || (o.baseline && isUrl(o.baseline))) throw new Error('give a local path; the tool never fetches a URL');
    if (!Object.hasOwn(FORMATS, o.format)) throw new Error(`unknown format ${o.format} (text, markdown, json or csv)`);
    if (!THRESHOLDS.includes(o.failOn)) throw new Error(`--fail-on takes error or warning, not ${o.failOn}`);
    if (o.maxGrowthGiven && !o.baseline) throw new Error('--max-growth needs --baseline');
    if (o.baseline !== null && o.baseline === o.file) throw new Error('the baseline is the same file as the map');
  }
  delete o.maxGrowthGiven;
  return o;
}

function clean(text) {
  return safeText(text, 1500);
}

// Exit code: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
export async function main(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }, limits = LIMITS, base = process.cwd()) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (error) {
    io.err(`linker-map-budget-check: ${clean(error.message)}\n\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    io.out(USAGE);
    return 0;
  }
  if (o.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  let report;
  try {
    report = await checkFile(o.file, { failOn: o.failOn, version: VERSION, limits: { ...LIMITS, ...limits }, base, warnPercent: o.warnPercent, budgets: o.budgets, maxObject: o.maxObject, top: o.top, baselinePath: o.baseline, maxGrowth: o.maxGrowth });
  } catch (error) {
    io.err(`linker-map-budget-check: ${clean(error.message)}\n`);
    return 2;
  }
  io.out(FORMATS[o.format](report));
  return report.gate.pass ? 0 : 1;
}
