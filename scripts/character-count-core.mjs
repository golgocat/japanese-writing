const units = new Set(['codepoints', 'graphemes', 'utf16', 'bytes']);
const lineBreaks = /\r\n|[\n\r\u0085\u2028\u2029]/gu;
const horizontalSpace = /[^\S\r\n\u0085\u2028\u2029]/gu;

export function countText(text, options = {}) {
  const unit = options.unit ?? 'codepoints';
  const normalization = options.normalization ?? 'none';
  const newlinePolicy = options.lineBreaks ?? 'exclude';
  const excludeSpaces = options.excludeSpaces ?? false;
  if (!units.has(unit)) throw new Error('Unsupported counting unit.');
  if (!['none', 'NFC'].includes(normalization)) throw new Error('Use none or NFC normalization.');
  if (!['include', 'exclude'].includes(newlinePolicy)) throw new Error('Use include or exclude for line breaks.');
  let value = normalization === 'none' ? text : text.normalize(normalization);
  if (newlinePolicy === 'exclude') value = value.replace(lineBreaks, '');
  if (excludeSpaces) value = value.replace(horizontalSpace, '');
  const count = unit === 'graphemes'
    ? [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(value)].length
    : unit === 'utf16' ? value.length
    : unit === 'bytes' ? new TextEncoder().encode(value).length
    : [...value].length;
  return { count, unit, normalization, lineBreaks: newlinePolicy, spaces: excludeSpaces ? 'exclude' : 'include' };
}

export function evaluateConstraint(count, kind, limit) {
  if (!['max', 'exact', 'target'].includes(kind)) throw new Error('Unsupported constraint.');
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Use a nonnegative safe integer.');
  return { kind, limit, delta: count - limit, passed: kind === 'target' ? null : kind === 'max' ? count <= limit : count === limit };
}
