import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countText, evaluateConstraint } from './count_characters.mjs';

test('counting preserves punctuation, spaces and text by default', () => {
  const source = '確認。 A\n次\r\n行\r末\u0085尾\u2028終\u2029了 ';
  assert.equal(countText(source).count, 12);
  assert.equal(countText('  A  ').count, 5);
  assert.equal(countText('').count, 0);
  assert.ok(source.includes('\r\n'));
});

test('combining characters normalize only when selected', () => {
  assert.equal(countText('か\u3099').count, 2);
  assert.equal(countText('が').count, 1);
  assert.equal(countText('か\u3099', { normalization: 'NFC' }).count, 1);
  assert.equal(countText('か\u3099', { unit: 'graphemes' }).count, 1);
});

test('emoji metrics remain distinct', () => {
  assert.equal(countText('😀').count, 1);
  assert.equal(countText('😀', { unit: 'utf16' }).count, 2);
  assert.equal(countText('😀', { unit: 'bytes' }).count, 4);
  assert.equal(countText('👨‍👩‍👧‍👦').count, 7);
  assert.equal(countText('👨‍👩‍👧‍👦', { unit: 'graphemes' }).count, 1);
});

test('line-break and space policies do not override each other', () => {
  assert.equal(countText('A\r\nB', { lineBreaks: 'include' }).count, 4);
  assert.equal(countText('A\r\nB', { lineBreaks: 'include', unit: 'graphemes' }).count, 3);
  assert.equal(countText(' A\t\u3000\nB ', { excludeSpaces: true }).count, 2);
  assert.equal(countText(' A\t\u3000\nB ', { excludeSpaces: true, lineBreaks: 'include' }).count, 3);
});

test('upper bounds, exact counts and approximate targets differ', () => {
  assert.equal(evaluateConstraint(49, 'max', 50).passed, true);
  assert.equal(evaluateConstraint(49, 'exact', 50).passed, false);
  assert.equal(evaluateConstraint(49, 'target', 50).passed, null);
  assert.equal(evaluateConstraint(51, 'target', 50).delta, 1);
  assert.equal(evaluateConstraint(0, 'exact', 0).passed, true);
});

test('invalid measurement settings fail rather than guess', () => {
  assert.throws(() => countText('文', { unit: 'x-post' }));
  assert.throws(() => countText('文', { normalization: 'NFKC' }));
  assert.throws(() => countText('文', { lineBreaks: 'trim' }));
  assert.throws(() => evaluateConstraint(1, 'exact', -1));
});

test('CLI checks actual input and reports no source text', () => {
  const script = fileURLToPath(new URL('./count_characters.mjs', import.meta.url));
  const input = '正式導入は未決定。\n';
  const run = (args) => spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8' });
  const exact = run(['--exact', '9']);
  assert.equal(exact.status, 0);
  assert.equal(JSON.parse(exact.stdout).count, 9);
  assert.equal(exact.stdout.includes('正式導入'), false);
  assert.equal(run(['--max', '8']).status, 1);
  assert.equal(run(['--target', '100']).status, 0);
  assert.equal(run(['--max', '10', '--exact', '10']).status, 2);
  assert.equal(run(['--max', '-1']).status, 2);
  assert.equal(run(['--exact']).status, 2);
});

test('CLI rejects malformed UTF-8 and preserves valid replacement characters and BOMs', () => {
  const script = fileURLToPath(new URL('./count_characters.mjs', import.meta.url));
  const run = (input, args = ['--exact', '1']) => spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8' });
  for (const input of [Buffer.from([0xff]), Buffer.from([0xe3, 0x81]), Buffer.from([0xe3, 0x28, 0x82])]) {
    const result = run(input);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
  }
  const bytes = run(Buffer.from([0xff]), ['--unit', 'bytes', '--exact', '3']);
  assert.equal(bytes.status, 2);
  assert.equal(bytes.stdout, '');
  assert.equal(run(Buffer.from('\uFFFD')).status, 0);
  assert.equal(run(Buffer.from('\uFEFF')).status, 0);
  assert.equal(run(Buffer.from('日😀'), ['--exact', '2']).status, 0);
});
