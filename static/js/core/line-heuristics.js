// Line classification used by cleaning and diagnostics.
export function isSceneBreak(line) {
  const t = line.trim();
  return (
    /^(?:\*\s*){3,}$/.test(t) ||
    /^(?:[-–—]\s*){3,}$/.test(t) ||
    /^#{1,3}$/.test(t) ||
    /^~{3,}$/.test(t) ||
    /^•{3,}$/.test(t)
  );
}
export function isListOrBullet(line) {
  return /^\s*(?:[-*•]\s+|\d{1,3}[.)]\s+|[a-zA-Z][.)]\s+)/.test(line);
}
export function isLikelySectionTitle(line) {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (isSceneBreak(t) || isListOrBullet(t)) return true;
  if (
    /^(?:chapter|hoofdstuk|part|deel|book|prologue|epilogue|appendix|contents|inhoud|acknowledg|copyright)\b/i.test(t)
  )
    return true;
  if (/^(?:[ivxlcdm]{1,8}|[IVXLCDM]{1,8}|\d{1,4})$/.test(t)) return true;
  if (t === t.toUpperCase() && /[A-ZÀ-Ý]/.test(t) && t.length <= 70) return true;
  return false;
}
export function endsLikeSentence(line) {
  return /[.!?:;…]["'”’)]*$/.test(line.trim());
}
export function shouldJoinLines(prev, current) {
  const a = prev.trim(),
    b = current.trim();
  if (!a || !b) return false;
  if (
    isSceneBreak(a) ||
    isSceneBreak(b) ||
    isLikelySectionTitle(a) ||
    isLikelySectionTitle(b) ||
    isListOrBullet(current) ||
    /^\s/.test(current)
  )
    return false;
  if (a.length < 45 && !/[A-Za-zÀ-ÖØ-öø-ÿ]-$/.test(a)) return false;
  return !endsLikeSentence(a);
}
export function isLikelyPageNumberLine(line, idx, lines) {
  const t = line.trim();
  if (!t) return false;
  if (/^[-–—]?\s*\d{1,4}\s*[-–—]?$/.test(t)) return true;
  if (/^(?:p\.?\s*|page\s+|pagina\s+)\d{1,4}(?:\s*(?:of|van|\/|-)\s*\d{1,4})?$/i.test(t)) return true;
  if (/^\d{1,4}\s*(?:\/|of|van)\s*\d{1,4}$/i.test(t)) return true;
  if (/^[ivxlcdm]{2,8}$/i.test(t)) {
    const prevBlank = idx === 0 || lines[idx - 1].trim() === '';
    const nextBlank = idx === lines.length - 1 || lines[idx + 1].trim() === '';
    return prevBlank && nextBlank;
  }
  return false;
}
export function repeatedLineCandidates(lines) {
  const map = new Map();
  lines.forEach((line, idx) => {
    const t = line.trim();
    if (t.length < 4 || t.length > 90 || isSceneBreak(t) || isLikelyPageNumberLine(t, idx, lines)) return;
    const key = t.replace(/\s+/g, ' ');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(idx);
  });
  const out = new Set();
  for (const positions of map.values()) {
    if (positions.length < 4) continue;
    if (positions[positions.length - 1] - positions[0] < 40) continue;
    positions.forEach((i) => out.add(i));
  }
  return out;
}
