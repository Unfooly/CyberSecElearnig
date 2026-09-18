# Prompt dla Claude Code — rebranding frontendu na Unfooly

Skopiuj folder `unfooly-brand/` do repo (np. `docs/brand/`) i wklej poniższy prompt.

---

Przeprowadź rebranding frontendu z „CyberSzkoło" na **Unfooly** zgodnie z `docs/brand/BRAND.md`. Wzorcem wyglądu są mockupy `docs/brand/mockups/dashboard.html`, `team.html`, `courses.html` (podgląd PNG w `mockups/png/`). Mockupy to statyczny HTML z CSS w `<style>` — przenieś ich układ i style na nasze komponenty React/Next.js, nie kopiuj HTML 1:1.

Zakres:

1. **Tokeny i font**
   - Dodaj zmienne CSS z sekcji „Kolory" w BRAND.md do globalnego arkusza (i rozszerzenie `tailwind.config` jeśli używamy Tailwinda).
   - Podłącz Plus Jakarta Sans przez `next/font/google` (wagi 500/600/700/800) i ustaw jako font bazowy.

2. **Logo**
   - Skopiuj `logo/` do `public/brand/`. Stwórz komponent `<Logo variant="dark" | "white" | "mono" />` renderujący SVG inline (`logo/unfooly-wordmark*.svg`), wysokość 26 px w nawigacji.
   - Podmień favicon (`favicon.svg` + `favicon.ico`) i ikony PWA/manifest (`png/unfooly-icon-192.png`, `-512.png`).
   - Zamień wszystkie wystąpienia nazwy „CyberSzkoło" w UI, tytułach stron, e-mailach transakcyjnych i metadanych na „Unfooly".

3. **Nawigacja**
   - 64 px, białe tło, aktywna pozycja z fioletowym podkreśleniem, moduły niegotowe („Kampanie phishingowe", „Zgłoszenia") wyszarzone z pillem „Wkrótce".
   - Avatar użytkownika = inicjały na tle `--accent-soft` (zamiast obrazka).

4. **Ekrany** — dostosuj do mockupów:
   - **Dashboard**: podtytuł z datą, przycisk „Eksportuj raport" (może być niepodpięty), 5 kafelków KPI (te bez danych jako „placeholder" z przerywanym borderem i pillem „Moduł wkrótce"), tabela działów z paskiem postępu i statusem.
   - **Zespół**: nagłówek z podsumowaniem liczby osób, przyciski `secondary` (Importuj z CSV) i `primary` (Zaproś pracownika), filtry, tabela z avatarami-inicjałami, pillami statusu i działu, akcje „Edytuj · Usuń".
   - **Kursy**: karta powitalna na `--accent-soft` z CTA, karta profilu z pierścieniem poziomu (SVG), ścieżka nauki jako lista kroków, biblioteka z zakładkami i kartami kursów, ranking z wyróżnionym wierszem „Ty".

5. **Komponenty wspólne**: Button (primary/secondary/ghost, rozmiar sm), Card, Pill, ProgressBar, EmptyState, Table — zgodnie z sekcją „Komponenty" w BRAND.md. Zastąp emoji ikonami Lucide.

6. **Puste stany**: każda pusta lista/tabela ma dostać EmptyState (ikona, nagłówek, zdanie, przycisk), zamiast „Brak danych".

Zasady: nie zmieniaj logiki ani API, tylko warstwę prezentacji. Zachowaj wszystkie istniejące teksty PL (poza nazwą marki). Zrób to w małych commitach: tokeny+font → logo+nav → wspólne komponenty → dashboard → zespół → kursy. Po każdym etapie pokaż zrzut ekranu.
