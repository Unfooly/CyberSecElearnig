const test = require('node:test');
const assert = require('node:assert/strict');
const { selectVersionsToDelete } = require('./select-versions-to-delete');

const v = (id, day, tags) => ({ id, created_at: `2026-09-${String(day).padStart(2, '0')}T10:00:00Z`, metadata: { container: { tags } } });
const ids = (list) => list.map((x) => x.id).sort((a, b) => a - b);

test('zostawia latest i 3 najnowsze sha-*, usuwa resztę', () => {
  const versions = [
    v(1, 1, ['sha-aaaaaaa']),
    v(2, 2, ['sha-bbbbbbb']),
    v(3, 3, ['sha-ccccccc']),
    v(4, 4, ['sha-ddddddd']),
    v(5, 5, ['sha-eeeeeee', 'latest']),
  ];
  // latest siedzi na wersji 5 (też sha) - zostają 5, 4, 3; kasujemy 1 i 2.
  assert.deepEqual(ids(selectVersionsToDelete(versions)), [1, 2]);
});

test('latest na starszej wersji też zostaje (dodatkowo do 3 sha)', () => {
  const versions = [
    v(1, 1, ['sha-aaaaaaa', 'latest']),
    v(2, 2, ['sha-bbbbbbb']),
    v(3, 3, ['sha-ccccccc']),
    v(4, 4, ['sha-ddddddd']),
    v(5, 5, ['sha-eeeeeee']),
  ];
  assert.deepEqual(ids(selectVersionsToDelete(versions)), [2]);
});

test('wersje bez tagów są usuwane', () => {
  const versions = [v(1, 1, []), v(2, 2, ['sha-bbbbbbb', 'latest']), v(3, 3, [])];
  assert.deepEqual(ids(selectVersionsToDelete(versions)), [1, 3]);
});

test('nie usuwa niczego, gdy nie ma ani latest, ani sha-* (bezpiecznik)', () => {
  assert.deepEqual(selectVersionsToDelete([v(1, 1, ['inny']), v(2, 2, [])]), []);
  assert.deepEqual(selectVersionsToDelete([]), []);
});

test('brakujące metadane nie wywracają funkcji', () => {
  assert.deepEqual(selectVersionsToDelete([{ id: 1, created_at: '2026-09-01T00:00:00Z' }]), []);
});

test('mniej wersji niż limit - nic do usunięcia', () => {
  const versions = [v(1, 1, ['sha-aaaaaaa']), v(2, 2, ['sha-bbbbbbb', 'latest'])];
  assert.deepEqual(selectVersionsToDelete(versions), []);
});
