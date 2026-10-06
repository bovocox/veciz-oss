import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capsSafe, upperTr } from '../src/index.ts';

test('capsSafe pre-maps dotted i for Turkish only', () => {
  assert.equal(capsSafe('Bugün için', 'tr'), 'Bugün İçİn');
  assert.equal(capsSafe('Bugün için', 'tr-TR'), 'Bugün İçİn');
  assert.equal(capsSafe('Today in', 'en'), 'Today in');
  assert.equal(capsSafe('Today in', null), 'Today in');
});

test('capsSafe keeps preserved brand words Latin', () => {
  assert.equal(capsSafe('Premium ile', 'tr', { preserve: ['premium'] }), 'PREMIUM İle');
});

test('upperTr uppercases with Turkish rules', () => {
  assert.equal(upperTr('ılık iğne'), 'ILIK İĞNE');
  assert.equal(upperTr('istanbul premium', { preserve: ['premium'] }), 'İSTANBUL PREMIUM');
});
