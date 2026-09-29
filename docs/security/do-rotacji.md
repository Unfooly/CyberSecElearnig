# Sekrety - inwentaryzacja i lista do rotacji (checklista na koniec projektu)

Repozytorium jest publiczne (decyzja właściciela, 2026-09-29); rotacja sekretów - na końcu projektu. Ten plik NIE zawiera żadnych
wartości (także przykładowych) - tylko nazwy, miejsca i status. Nowych sekretów w repo nie dodajemy (hook `pre-commit` z gitleaks,
`.githooks/pre-commit`).

## Skan historii (2026-09-29)

- Narzędzie: gitleaks (obraz Docker `zricethezav/gitleaks`), `detect --log-opts="--all" --redact` - **cała historia wszystkich
  gałęzi**, 575 commitów.
- Dodatkowo celowane przeszukanie historii na formaty prawdziwych kluczy, wynik 0 trafień:
  - ElevenLabs `sk_…`;
  - MailerSend `mlsn.…`;
  - sekret R2 (64 znaki hex);
  - AWS `AKIA…`;
  - GitHub `ghp_…`;
  - Slack `xox…`.
- Pliki `.env`, `.env.local`, `.env.prod` nigdy nie trafiły do historii (`scripts/content/.env.local` jest w `.gitignore`).

**Wynik: brak prawdziwych sekretów w historii.** 17 trafień gitleaks (reguła `generic-api-key`), wszystkie fałszywe:

| Plik | Commit | Typ | Ocena |
|---|---|---|---|
| `.env.prod.example` (linie 38-39) | `2f1fde1` | `JWT_SECRET`, `JWT_REFRESH_SECRET` | szablon: tekst „zmień na losowy sekret…” |
| `apps/api/test/auth.e2e-spec.ts` (7 linii) | `8fbbc2e`, `aeec0d0` | hasła i tokeny w testach | stałe testowe (fikcyjne hasła użytkowników testowych) |
| `apps/api/test/users.e2e-spec.ts` (4 linie) | `aeec0d0` | hasła i token resetu w testach | stałe testowe |
| `apps/api/test/phishing-tracking.e2e-spec.ts` (1 linia) | `bec968f` | „password” w danych testowych | celowo uszkodzony JSON w teście |
| `scripts/content/src/env.test.ts` (2 linie) | `b5eaaa7` | `ELEVENLABS_API_KEY` w teście parsera `.env` | wartość testowa („sekret-…”) |

Nic nie wymaga rotacji z powodu historii repozytorium. Historia nie jest przepisywana.

## Checklista rotacji na koniec projektu

Sekrety używane przez projekt (poza repo: serwer, `.env` lokalne, magazyny). Rotacja na koniec - bo repo jest publiczne, a część
wartości krążyła po maszynach deweloperskich i sesjach:

- [ ] `JWT_SECRET`, `JWT_REFRESH_SECRET` - API (unieważnia wszystkie sesje; zaplanować okno)
- [ ] `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` (i `DATABASE_URL`, `DATABASE_URL_APP` z nimi) - baza produkcyjna
- [ ] `MAILERSEND_API_TOKEN` - e-maile transakcyjne
- [ ] `PHISHING_MAILERSEND_API_TOKEN`, `PHISHING_SMTP_URL` (hasło w URL) - wysyłka symulacji phishingowych
- [ ] `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` - płatności (jeśli już ustawione)
- [ ] `TUNNEL_TOKEN` - tunel do serwera testowego
- [ ] `ELEVENLABS_API_KEY` - TTS (`scripts/content/.env.local`)
- [ ] `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` - magazyn treści (`scripts/content/.env.local`); `R2_ACCOUNT_ID` i `R2_ENDPOINT` nie są
      sekretami, ale nie publikujemy ich bez potrzeby
- [ ] `GH_TOKEN` / sesja `gh` na maszynach, z których działał agent
- [ ] Po rotacji: ponowny skan (`gitleaks detect --log-opts="--all"`), wpis daty w tym pliku

## Zasady od teraz

- Sekrety wyłącznie w zmiennych środowiskowych / `.env` spoza repo (CLAUDE.md, reguła 5).
- Hook `pre-commit` skanuje zmiany w indeksie gitleaksem i odrzuca commit z sekretem. Świadome wyjątki - komentarz `gitleaks:allow`
  w tej linii, tylko dla wartości testowych.
- Pliki `*.example` zawierają wyłącznie opisy („zmień na…”), nigdy prawdziwe wartości.
