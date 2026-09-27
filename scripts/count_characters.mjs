#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
    : unit === 'bytes' ? Buffer.byteLength(value, 'utf8')
    : [...value].length;
  return { count, unit, normalization, lineBreaks: newlinePolicy, spaces: excludeSpaces ? 'exclude' : 'include' };
}

export function evaluateConstraint(count, kind, limit) {
  if (!['max', 'exact', 'target'].includes(kind)) throw new Error('Unsupported constraint.');
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Use a nonnegative safe integer.');
  return { kind, limit, delta: count - limit, passed: kind === 'target' ? null : kind === 'max' ? count <= limit : count === limit };
}

function main(args) {
  if (args.includes('--help')) {
    process.stdout.write('Usage: node scripts/count_characters.mjs [FILE|-] [--unit codepoints|graphemes|utf16|bytes] [--normalization none|NFC] [--line-breaks include|exclude] [--exclude-spaces] [--max N|--exact N|--target N]\nDefaults: stdin, codepoints, no normalization, line breaks excluded, spaces included. Input is never trimmed or printed. Include preserves raw line breaks (CRLF is two code points). Exit: 0 valid/target, 1 constraint unmet, 2 invalid input/options.\n');
    return;
  }
  const options = {};
  let file;
  let constraint;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--exclude-spaces') { options.excludeSpaces = true; continue; }
    if (['--unit', '--normalization', '--line-breaks', '--max', '--exact', '--target'].includes(argument)) {
      const value = args[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      if (['--max', '--exact', '--target'].includes(argument)) {
        if (constraint) throw new Error('Choose one of --max, --exact or --target.');
        if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Use a nonnegative safe integer.');
        constraint = { kind: argument.slice(2), limit: Number(value) };
      } else {
        options[argument === '--line-breaks' ? 'lineBreaks' : argument.slice(2)] = value;
      }
      continue;
    }
    if (argument.startsWith('-') && argument !== '-') throw new Error(`Unknown option: ${argument}.`);
    if (file !== undefined) throw new Error('Provide only one input file.');
    file = argument;
  }
  const input = readFileSync(file === undefined || file === '-' ? 0 : file);
  // Reject malformed UTF-8 without silently replacing or removing input characters.
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
  const result = countText(text, options);
  if (constraint) result.constraint = evaluateConstraint(result.count, constraint.kind, constraint.limit);
  result.runtime = { node: process.versions.node, unicode: process.versions.unicode, icu: process.versions.icu };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.constraint?.passed === false) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}
