// Wybiera wersje obrazu w GHCR do usunięcia. Zostaje:
//  - każda wersja z tagiem `latest`,
//  - `keepShaTags` najnowszych wersji z tagiem `sha-*`.
// Reszta (starsze sha-*, wersje bez tagów) jest do usunięcia. Czysta funkcja,
// testowana w select-versions-to-delete.test.js - bez wywołań API.
//
// `versions`: odpowiedź GET .../packages/container/{name}/versions
// (pola: id, created_at, metadata.container.tags).
function selectVersionsToDelete(versions, { keepShaTags = 3 } = {}) {
  const tagsOf = (version) => version?.metadata?.container?.tags ?? [];
  const newestFirst = [...versions].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const keep = new Set();
  let keptSha = 0;
  for (const version of newestFirst) {
    const tags = tagsOf(version);
    if (tags.includes('latest')) {
      keep.add(version.id);
    }
    if (tags.some((tag) => tag.startsWith('sha-')) && keptSha < keepShaTags) {
      keep.add(version.id);
      keptSha += 1;
    }
  }

  // Bezpiecznik: nigdy nie kasujemy wszystkiego (np. zmiana formatu odpowiedzi).
  if (keep.size === 0) {
    return [];
  }
  return newestFirst.filter((version) => !keep.has(version.id));
}

module.exports = { selectVersionsToDelete };
