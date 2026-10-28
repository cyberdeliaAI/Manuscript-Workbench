// Mojibake (UTF-8 read as Windows-1252) detection and repair.
export const CP1252_SPECIALS = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};
export const CONT =
  '\\u0080-\\u00BF\\u20AC\\u201A\\u0192\\u201E\\u2026\\u2020\\u2021\\u02C6\\u2030\\u0160\\u2039\\u0152\\u017D\\u2018\\u2019\\u201C\\u201D\\u2022\\u2013\\u2014\\u02DC\\u2122\\u0161\\u203A\\u0153\\u017E\\u0178';
export const SIG_RE = new RegExp('[\\u00C2-\\u00F4][' + CONT + ']');
export const SIG_RE_G = new RegExp('[\\u00C2-\\u00F4][' + CONT + ']', 'g');
export function charToCp1252Byte(code) {
  if (code <= 0xff) return code;
  if (CP1252_SPECIALS[code] !== undefined) return CP1252_SPECIALS[code];
  return -1;
}
export function isEligible(code) {
  return (code >= 0x80 && code <= 0xff) || CP1252_SPECIALS[code] !== undefined;
}
export function utf8SequenceLength(lead) {
  return lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0;
}
export function repairMojibakeRun(chars) {
  const strict = new TextDecoder('utf-8', { fatal: true });
  let out = '',
    i = 0;
  while (i < chars.length) {
    const lead = charToCp1252Byte(chars[i].codePointAt(0));
    const len = utf8SequenceLength(lead);
    if (len > 0 && i + len <= chars.length) {
      const bytes = [lead];
      let ok = true;
      for (let k = 1; k < len; k++) {
        const b = charToCp1252Byte(chars[i + k].codePointAt(0));
        if (b < 0x80 || b > 0xbf) {
          ok = false;
          break;
        }
        bytes.push(b);
      }
      if (ok) {
        try {
          out += strict.decode(new Uint8Array(bytes));
          i += len;
          continue;
        } catch (e) {}
      }
    }
    out += chars[i];
    i++;
  }
  return out;
}
export function fixMojibake(text) {
  const chars = [...text];
  let out = '',
    i = 0;
  while (i < chars.length) {
    if (isEligible(chars[i].codePointAt(0))) {
      let j = i;
      while (j < chars.length && isEligible(chars[j].codePointAt(0))) j++;
      const run = chars.slice(i, j);
      out += SIG_RE.test(run.join('')) ? repairMojibakeRun(run) : run.join('');
      i = j;
    } else {
      out += chars[i];
      i++;
    }
  }
  return out;
}
