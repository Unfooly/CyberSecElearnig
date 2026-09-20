<!--
Wypełnij wszystkie sekcje; jeśli punkt nie dotyczy tej zmiany, wpisz "nie dotyczy" (nie usuwaj sekcji).
Zasady pracy: CLAUDE.md, sekcja "Praca zespołowa: branże i pull requesty". Jeden PR = jedna logiczna zmiana.
-->

## Po co ta zmiana

<!-- Problem/zadanie w 1-3 zdaniach. Zgłoszenie: "Closes #123" albo link. Decyzja właściciela produktu, jeśli istnieje (data, wpis w docs/decisions.md). -->

## Co się zmienia

<!-- Najważniejsze zmiany, po ludzku. Co świadomie POZA zakresem tego PR. -->

## Jak to sprawdzono

- [ ] `npm run test --workspace=apps/api` i `npm run lint --workspace=apps/api`
- [ ] `npm run test --workspace=apps/web`, `npm run lint --workspace=apps/web` i `npm run typecheck --workspace=apps/web`
- [ ] `npm run test:e2e --workspace=apps/api` (Postgres + Redis) albo replika CI - wynik: <!-- np. 673/673 -->
- [ ] Nowa funkcja ma test: happy path + przypadek brzegowy (+ test izolacji tenantów A/B, jeśli dotyka danych klienckich)
- [ ] Sprawdzone ręcznie (opisz co i jak, jeśli dotyczy UI):

## Ryzyka (zaznacz i opisz; "nie dotyczy" jeśli nic)

- [ ] **Izolacja tenantów (Zasada nr 1):** każde zapytanie filtruje po `organizationId` + RLS; nowy endpoint ma test A/B; brak nowego obejścia RLS
      (nowy wyjątek = decyzja + opis w kodzie + wpis w CLAUDE.md):
- [ ] **Migracja bazy:** przez Prisma Migrate, migracja i `schema.prisma` w tym samym commicie, nowa tabela z `organizationId` ma `onDelete: Cascade`
      i RLS; nie edytowałem migracji z `main`; wymaga PostgreSQL 15+? Kolejność względem cudzych migracji:
- [ ] **Uprawnienia i guardy:** rola sprawdzana w API (nie tylko w UI); nowy endpoint domyślnie zablokowany dla organizacji PENDING
      (`@AllowPendingOrganization()` tylko z uzasadnieniem):
- [ ] **Wysyłka maili / dane osób trzecich:** limity, brak ujawniania istnienia kont (anty-enumeracja), treść od obcej strony przycięta i
      escapowana, brak danych osobowych w logach:
- [ ] **Dane osobowe (RODO):** nowe dane osobowe wpisane w `docs/legal/privacy-policy-checklist.md` (cel, retencja):
- [ ] **Zadania w tle:** idempotentne, race-safe, dane klienckie przez `runInOrgContext`, test z zamrożonym zegarem:
- [ ] **Sekrety:** żadnych sekretów, dumpów ani danych osobowych w kodzie, testach, opisie i logach

## Review

- [ ] `security-reviewer` (auth, guardy, RLS, dane klienckie, wysyłka maili, wyniki symulacji, import) albo `code-reviewer` (reszta)
- Werdykt i uwagi wraz z rozstrzygnięciem właściciela produktu (werdykt "nie gotowy" blokuje merge, CLAUDE.md reguła 10):

## Dokumentacja i decyzje

- [ ] Zmiana zachowania/bezpieczeństwa/konwencji ma wpis w `docs/decisions.md`
- [ ] Zaktualizowano dokumenty modułu (np. `docs/user-import.md`, `docs/phishing-simulations.md`) i README, jeśli dotyczy
- [ ] Odłożone uwagi trafiły do backlogu (`docs/backlog-issues.md` / zgłoszenie), nie zostały tylko w komentarzu

## Przed merge

- [ ] CI zielone (lint + testy, e2e); sporadyczne "Jest did not exit" przy zielonych testach nie blokuje
- [ ] Branch zrebase'owany na aktualny `main` (bez merge commitów z `main`)
- [ ] Sposób scalania: rebase and merge (małe, opisowe commity) albo squash (commity to szum)
