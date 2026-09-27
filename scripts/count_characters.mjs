#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { countText, evaluateConstraint } from './character-count-core.mjs';
export { countText, evaluateConstraint } from './character-count-core.mjs';

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
