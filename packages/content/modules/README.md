# Moduły treści

Każdy moduł to katalog `<slug>/` z `module.json` (wymagany do importu - `content-import`, patrz `docs/decisions.md` D-051
pkt 11) i, opcjonalnie, `assets/` z surowymi źródłami obrazów/avatarów przed publikacją (`scripts/content`, `docs/content-pipeline.md`).

Ten plik utrzymuje katalog w repozytorium (Dockerfile `apps/api` kopiuje `packages/content/modules` do obrazu -
WYŁĄCZNIE pliki `module.json`, surowe assety zostają poza obrazem, patrz komentarz w Dockerfile).
