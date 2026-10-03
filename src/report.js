// Report formats: text for a terminal, Markdown for a pull request or job summary, JSON for other tools, CSV for a
// spreadsheet. Findings are grouped by area, and each one quotes the sentence of the GNU ld manual that it rests on.

import { AREAS } from './rules.js';
import { grouped } from './size.js';

function plural(count, one, many = `${one}s`) {
  return `${grouped(count)} ${count === 1 ? one : many}`;
}

function countsLine(c) {
  return `${c.error} error, ${c.warning} warning, ${c.info} info`;
}

function gateLine(r) {
  return r.gate.pass ? `GATE: PASS (--fail-on ${r.gate.failOn})` : `GATE: FAIL - ${r.gate.reason}`;
}

// The findings of one area, for the areas that have any.
function groups(r) {
  const out = [];
  for (const a of AREAS) {
    const own = r.findings.filter((f) => f.area === a.id);
    if (own.length) out.push({ title: a.title, findings: own });
  }
  return out;
}

function mapLine(r) {
  const m = r.map;
  if (m.format !== 'gnu-ld') return `map: not a GNU ld map (${m.format}), ${plural(m.lines, 'line')}, not read`;
  const lines = `${plural(m.lines, 'line')} (${grouped(m.read)} read, ${grouped(m.skipped)} skipped, ${grouped(m.blank)} blank, ${grouped(m.unparsed)} not parsed)`;
  const o = m.outputSections;
  return `map: GNU ld, ${plural(m.regions, 'region')}, ${lines}, ${grouped(o.inRegion)} output ${o.inRegion === 1 ? 'section' : 'sections'} in a region, ${grouped(o.outsideRegions)} outside every region, ${grouped(o.notAllocated)} not allocated, ${plural(m.inputSections, 'input section')} from ${plural(m.objects, 'object')}`;
}

function limitsLine(r) {
  const m = r.map;
  return `limits: near full above ${m.warnPercent}%, an object above ${m.maxObject} of a region, top ${m.top}${m.maxGrowth ? `, growth above ${m.maxGrowth} of a region` : ''}`;
}

const signed = (n) => (n > 0 ? `+${grouped(n)}` : grouped(n));

function table(rows, right) {
  const widths = rows[0].map((_, k) => Math.max(...rows.map((row) => String(row[k]).length)));
  return rows.map((row) => `  ${row.map((cell, k) => (k === row.length - 1 ? String(cell) : right.includes(k) ? String(cell).padStart(widths[k]) : String(cell).padEnd(widths[k]))).join('  ')}`.trimEnd());
}

export function toText(r) {
  const lines = [`linker-map-budget-check: ${r.map.file}${r.map.baseline ? ` (baseline ${r.map.baseline})` : ''}`, mapLine(r)];
  if (r.map.format === 'gnu-ld') lines.push(limitsLine(r));
  lines.push('areas:');
  for (const a of r.areas) lines.push(`  ${a.title.padEnd(15)}  ${a.result.padEnd(4)}  ${a.detail}`);
  if (r.regions.length) {
    lines.push('regions:');
    lines.push(...table([['region', 'origin', 'length', 'budget', 'used', 'free', 'use', 'attributes'], ...r.regions.map((g) => [g.name, g.origin, grouped(g.length), grouped(g.budget), grouped(g.used), grouped(g.free), g.percent, g.attributes])], [2, 3, 4, 5, 6]));
  }
  for (const l of r.largest) {
    lines.push(`largest in ${l.region}:`);
    lines.push(...table([['bytes', 'share', 'object'], ...l.objects.map((o) => [grouped(o.bytes), o.share, o.name])], [0, 1]));
    if (l.archives.length) lines.push(...table([['bytes', 'share', 'archive'], ...l.archives.map((a) => [grouped(a.bytes), a.share, `${a.name} (${plural(a.members, 'member')})`])], [0, 1]));
  }
  if (r.growth) {
    lines.push(`growth since ${r.map.baseline}:`);
    lines.push(...table([['region', 'before', 'after', 'growth', 'limit'], ...r.growth.map((g) => [g.name, grouped(g.before), grouped(g.after), signed(g.growth), grouped(g.limit)])], [1, 2, 3, 4]));
  }
  lines.push(`findings: ${countsLine(r.counts)}`);
  if (!r.findings.length) lines.push('', 'no findings');
  for (const g of groups(r)) {
    lines.push('', `${g.title} (${plural(g.findings.length, 'finding')})`);
    for (const f of g.findings) {
      lines.push('', `  ${f.severity.toUpperCase().padEnd(7)}  ${f.id}  ${f.file} ${f.where}  line ${f.line}`);
      lines.push(`           ${f.message}`);
      for (const b of f.basis) lines.push(`           basis: "${b.text}" (${b.section}, ${b.source})`);
      lines.push(`           fix: ${f.fix}`);
    }
  }
  if (r.notes.length) lines.push('');
  for (const note of r.notes) lines.push(`note: ${note}`);
  lines.push('', gateLine(r));
  return lines.join('\n') + '\n';
}

// A Markdown table cell: backslashes, pipes, square brackets and backticks escaped, line breaks flattened, and <, > and &
// written as entities, so text from the input file cannot break the table, make a link or be read as HTML.
export function mdCell(t) {
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[[\]`*_]/g, (c) => `\\${c}`)
    .replace(/\r?\n|\r/g, ' ');
}

export function toMarkdown(r) {
  const lines = [`## linker-map-budget-check: ${countsLine(r.counts)}`, '', `File: \`${r.map.file.replace(/[`\r\n]/g, "'")}\`${r.map.baseline ? `, baseline \`${r.map.baseline.replace(/[`\r\n]/g, "'")}\`` : ''}. ${mdCell(mapLine(r).replace(/^map: /, 'Map: '))}.${r.map.format === 'gnu-ld' ? ` ${mdCell(limitsLine(r).replace(/^limits: /, 'Limits: '))}.` : ''}`];
  lines.push('', '| Area | Result | Detail |', '| --- | --- | --- |');
  for (const a of r.areas) lines.push(`| ${mdCell(a.title)} | ${a.result === 'fail' ? '**fail**' : mdCell(a.result)} | ${mdCell(a.detail)} |`);
  if (r.regions.length) {
    lines.push('', '| Region | Origin | Length | Budget | Used | Free | Use | Attributes |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const g of r.regions) lines.push(`| ${mdCell(g.name)} | ${g.origin} | ${grouped(g.length)} | ${grouped(g.budget)} | ${grouped(g.used)} | ${grouped(g.free)} | ${g.percent} | ${mdCell(g.attributes)} |`);
  }
  for (const l of r.largest) {
    lines.push('', `Largest in ${mdCell(l.region)}:`, '', '| Object or archive | Bytes | Share |', '| --- | ---: | ---: |');
    for (const o of l.objects) lines.push(`| ${mdCell(o.name)} | ${grouped(o.bytes)} | ${o.share} |`);
    for (const a of l.archives) lines.push(`| ${mdCell(`${a.name} (archive, ${plural(a.members, 'member')})`)} | ${grouped(a.bytes)} | ${a.share} |`);
  }
  if (r.growth) {
    lines.push('', '| Region | Before | After | Growth | Limit |', '| --- | ---: | ---: | ---: | ---: |');
    for (const g of r.growth) lines.push(`| ${mdCell(g.name)} | ${grouped(g.before)} | ${grouped(g.after)} | ${signed(g.growth)} | ${grouped(g.limit)} |`);
  }
  if (!r.findings.length) lines.push('', 'No findings.');
  for (const g of groups(r)) {
    lines.push('', `### ${mdCell(g.title)}`, '', '| Severity | Check | Where | Message | Basis | Fix |', '| --- | --- | --- | --- | --- | --- |');
    for (const f of g.findings) {
      const basis = f.basis.map((b) => `"${b.text}" (${b.section}, ${b.source})`).join(' ');
      lines.push(`| ${f.severity} | ${mdCell(f.id)} | ${mdCell(`${f.where} (line ${f.line})`)} | ${mdCell(f.message)} | ${mdCell(basis)} | ${mdCell(f.fix)} |`);
    }
  }
  if (r.notes.length) lines.push('');
  for (const note of r.notes) lines.push(`- ${mdCell(note)}`);
  lines.push('', r.gate.pass ? `**Gate passed** (--fail-on ${r.gate.failOn}).` : `**Gate failed:** ${mdCell(r.gate.reason)}.`);
  return lines.join('\n') + '\n';
}

export function toJson(r) {
  return JSON.stringify(r, null, 2) + '\n';
}

// RFC 4180 quoting, and a leading quote on cells a spreadsheet would read as a formula.
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per finding.
export function toCsv(r) {
  const rows = [['severity', 'area', 'id', 'file', 'where', 'line', 'subject', 'message', 'basis', 'source', 'fix']];
  for (const f of r.findings) rows.push([f.severity, f.area, f.id, f.file, f.where, String(f.line), f.subject, f.message, f.basis.map((b) => b.text).join(' '), f.source, f.fix]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
