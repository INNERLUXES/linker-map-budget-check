// Sizes and limits as the person writes them on the command line (480K, 0x78000, 1M, 90%), and as the report shows
// them (bytes with thousands separators, addresses in hexadecimal). K and M are 1,024 and 1,048,576, as in a linker
// script.

export const MAX_BYTES = 2 ** 48;

// A size in bytes: a decimal or 0x hexadecimal number, with an optional K or M. Returns null for anything else.
export function parseSize(text) {
  const m = /^(0x[0-9a-f]{1,12}|[0-9]{1,15})([km])?$/i.exec(String(text).trim());
  if (!m) return null;
  const base = m[1].toLowerCase().startsWith('0x') ? parseInt(m[1].slice(2), 16) : Number(m[1]);
  const factor = m[2] ? (m[2].toLowerCase() === 'k' ? 1024 : 1048576) : 1;
  const value = base * factor;
  return Number.isSafeInteger(value) && value <= MAX_BYTES ? value : null;
}

// A limit: a size in bytes ({ bytes }) or a percent with up to two decimals ({ percent }). Returns null for anything
// else, or for a percent above 100.
export function parseLimit(text) {
  const s = String(text).trim();
  const p = /^([0-9]{1,3}(?:\.[0-9]{1,2})?)%$/.exec(s);
  if (p) {
    const percent = Number(p[1]);
    return percent <= 100 ? { percent } : null;
  }
  const bytes = parseSize(s);
  return bytes === null ? null : { bytes };
}

// The number of bytes a limit stands for, for a region of this size. A percent is rounded down.
export function limitBytes(limit, regionBytes) {
  return limit.bytes !== undefined ? limit.bytes : Math.floor((regionBytes * limit.percent) / 100);
}

// A limit as the person wrote it, for the report: "25%" or "16,384 bytes".
export function limitText(limit) {
  return limit.bytes !== undefined ? bytesText(limit.bytes) : `${limit.percent}%`;
}

// A count with thousands separators: 66,124.
export function grouped(n) {
  return Number(n).toLocaleString('en-US');
}

// A number of bytes: "1 byte", "66,124 bytes".
export function bytesText(n) {
  return `${grouped(n)} ${n === 1 || n === -1 ? 'byte' : 'bytes'}`;
}

// An address in hexadecimal with eight digits, or sixteen when it does not fit in 32 bits.
export function hex(value) {
  const v = BigInt(value);
  const digits = v > 0xffffffffn ? 16 : 8;
  return `0x${v.toString(16).padStart(digits, '0')}`;
}

// A share as a percent with one decimal: 100.9%.
export function percentText(part, whole) {
  if (whole <= 0) return part > 0 ? 'over' : '0.0%';
  return `${((part * 100) / whole).toFixed(1)}%`;
}
