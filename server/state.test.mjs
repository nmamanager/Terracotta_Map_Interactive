import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce } from './state.mjs';

const owners = { pyramid: 1, waterbirds: 1, size: 1, army: 2, chariots: 3 };
const run = (...msgs) => msgs.reduce((s, m) => reduce(s, m, owners), initialState());

test('select shows the landmark on its own screen', () => {
  assert.deepEqual(run({ type: 'select', screen: 1, landmark: 'pyramid' }), { seq: 1, selections: { 1: 'pyramid', 2: null, 3: null } });
});

test('reselect on the same screen replaces the landmark', () => {
  assert.deepEqual(
    run({ type: 'select', screen: 1, landmark: 'pyramid' }, { type: 'select', screen: 1, landmark: 'waterbirds' }),
    { seq: 2, selections: { 1: 'waterbirds', 2: null, 3: null } },
  );
});

test('three screens hold lines at once', () => {
  assert.deepEqual(
    run({ type: 'select', screen: 1, landmark: 'size' }, { type: 'select', screen: 2, landmark: 'army' }, { type: 'select', screen: 3, landmark: 'chariots' }),
    { seq: 3, selections: { 1: 'size', 2: 'army', 3: 'chariots' } },
  );
});

test('clear removes only that screen', () => {
  assert.deepEqual(
    run({ type: 'select', screen: 1, landmark: 'pyramid' }, { type: 'select', screen: 2, landmark: 'army' }, { type: 'clear', screen: 1 }),
    { seq: 3, selections: { 1: null, 2: 'army', 3: null } },
  );
});

test('a screen cannot select another screen\'s landmark', () => {
  assert.deepEqual(run({ type: 'select', screen: 2, landmark: 'pyramid' }), { seq: 0, selections: { 1: null, 2: null, 3: null } });
});

test('unknown screens, landmarks and message types are ignored', () => {
  assert.deepEqual(
    run({ type: 'select', screen: 4, landmark: 'pyramid' }, { type: 'select', screen: 1, landmark: 'nope' }, { type: 'explode', screen: 1 }, null),
    { seq: 0, selections: { 1: null, 2: null, 3: null } },
  );
});

test('hello after a reconnect restores the screen\'s selection, and repeating it changes nothing', () => {
  const hello = { type: 'hello', role: 'touch', screen: 3, selection: 'chariots' };
  assert.deepEqual(run(hello, hello), { seq: 1, selections: { 1: null, 2: null, 3: 'chariots' } });
});

test('hello with no selection clears a stale line', () => {
  assert.deepEqual(
    run({ type: 'select', screen: 2, landmark: 'army' }, { type: 'hello', role: 'touch', screen: 2, selection: null }),
    { seq: 2, selections: { 1: null, 2: null, 3: null } },
  );
});
