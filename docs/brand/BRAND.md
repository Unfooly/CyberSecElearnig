# Unfooly — brand & UI guide

Platforma security awareness (dawniej „CyberSzkoło"). Nazwa marki: **Unfooly** (w logotypie zapis małymi literami: `unfooly.`).
Ton: pewny, prosty, bez straszenia. Pracownik nie jest „najsłabszym ogniwem" — jest kimś, kogo nie da się nabrać.

## Logo

Logotyp to **własne, geometryczne liternictwo** (nie font) — pliki SVG są samowystarczalne i nie wymagają żadnego fontu.

| Plik | Użycie |
|---|---|
| `logo/unfooly-wordmark.svg` | Podstawowe logo na jasnym tle (czarne litery, fioletowa kropka) |
| `logo/unfooly-wordmark-white.svg` | Na ciemnym tle |
| `logo/unfooly-wordmark-mono.svg` | Jednokolorowe (druk, stopka, watermark) |
| `logo/unfooly-icon.svg` | Ikona aplikacji / avatar (czarny kwadrat, `u.`) |
| `logo/unfooly-icon-accent.svg` | Ikona na fioletowym tle |
| `logo/unfooly-icon-light.svg` | Ikona na białym tle (np. w jasnym motywie systemu) |
| `logo/favicon.svg`, `logo/favicon.ico` | Favicon (SVG dla nowoczesnych przeglądarek, ICO jako fallback) |
| `logo/png/*` | Eksporty PNG: wordmark 1600 px, ikona 512/192/64/32/16 px |

Zasady:
- W nawigacji logotyp ma **26 px wysokości** (`height: 26px; width: auto`). Minimalna wysokość: 18 px.
- Pole ochronne: co najmniej wysokość litery „u" z każdej strony.
- Kropka jest zawsze w kolorze akcentu `#6C5CE7` (poza wersją mono). Nie zmieniaj jej koloru ani nie usuwaj.
- Nie odtwarzaj logotypu fontem. Używaj SVG (najlepiej inline w komponencie `<Logo />`, żeby dziedziczyć kolor przez `currentColor` w wersji mono).

## Kolory (CSS variables)

```css
:root {
  --ink: #131313;          /* tekst główny, tła ciemne, przycisk "ink" */
  --paper: #F6F6F4;        /* tło strony */
  --surface: #FFFFFF;      /* karty, nav, inputy */
  --border: #E6E6E2;       /* obramowania, separatory */
  --muted: #6F6F6B;        /* tekst drugorzędny, nagłówki tabel */
  --muted-2: #9A9A96;      /* tekst wyłączony, "wkrótce" */

  --accent: #6C5CE7;       /* primary: przyciski, aktywna zakładka, progres, kropka w logo */
  --accent-hover: #5B4BD6;
  --accent-soft: #EEEBFF;  /* tła pilli i wyróżnień */
  --accent-ink: #3F32B5;   /* tekst na accent-soft, linki (kontrast AA na białym) */

  --success: #1E9E6A;  --success-soft: #E6F6EE;
  --warning: #C77C0F;  --warning-soft: #FFF3DF;
  --danger:  #D9483B;  --danger-soft:  #FDECEA;

  --highlight: #FFE066;    /* zakreślacz: WYŁĄCZNIE zakreślony wiersz-dowód w teczce sprawy (D-083) */
}
```

Semantyka: **accent** = akcja i postęp, **success** = komplet/ukończone, **warning** = zaległe/terminy, **danger** = tylko akcje destrukcyjne (Usuń) oraz pieczątki w treści szkoleń (POUFNE, PRIORYTET). Nie używaj zieleni jako koloru marki — zieleń zostaje wyłącznie statusem. **highlight** to kolor funkcyjny zakreślacza, nie tło ani akcent interfejsu.

Teczka sprawy (odtwarzacz, D-083): teczka `accent-soft` z krawędzią `border`, arkusze `surface`, aktywna przekładka `accent`, pieczątka POUFNE `danger`, zakreślony wiersz `highlight`; treść dokumentów w Courier Prime (`font-typewriter`).

Tailwind (jeśli projekt używa Tailwinda) — `tailwind.config.js`:

```js
theme: {
  extend: {
    colors: {
      ink: '#131313', paper: '#F6F6F4', surface: '#FFFFFF', border: '#E6E6E2',
      muted: { DEFAULT: '#6F6F6B', 2: '#9A9A96' },
      accent: { DEFAULT: '#6C5CE7', hover: '#5B4BD6', soft: '#EEEBFF', ink: '#3F32B5' },
      success: { DEFAULT: '#1E9E6A', soft: '#E6F6EE' },
      warning: { DEFAULT: '#C77C0F', soft: '#FFF3DF' },
      danger:  { DEFAULT: '#D9483B', soft: '#FDECEA' },
      highlight: '#FFE066',
    },
    fontFamily: { sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'] },
    borderRadius: { card: '16px', btn: '10px' },
    boxShadow: { card: '0 1px 2px rgba(19,19,19,.04), 0 8px 24px -16px rgba(19,19,19,.18)' },
  }
}
```

## Typografia

- Font UI: **Plus Jakarta Sans** (Google Fonts / `next/font/google`), wagi 500, 600, 700, 800. Fallback: `system-ui`.
- H1 strony: 28 px / 800 / letter-spacing -0.02em. H2 sekcji/karty: 18 px / 700. Tekst: 14 px / 500, line-height 1.5.
- Liczby KPI: 32 px / 800 / letter-spacing -0.03em; jednostka obok w 16 px / 600 / muted.
- Nagłówki tabel: 12 px / 700 / uppercase / letter-spacing 0.04em / muted.
- Font „maszynowy” (wyjątek, D-081): **Courier Prime** (`next/font/google`, self-hosted, klasa Tailwind `font-typewriter`),
  wagi 400 i 700 - WYŁĄCZNIE numer sprawy w odprawie i treść dokumentów w teczce sprawy. Nigdzie indziej (nagłówki, przyciski,
  tekst maszyny do pisania w odprawie - ten jest w Plus Jakarta Sans, „maszynowość” daje sama animacja pisania).

## Komponenty (zobacz `mockups/*.html` — tam jest gotowy CSS dla każdego)

- **Nav**: 64 px, białe tło, dolna krawędź `--border`. Aktywna pozycja: tekst `--ink` + 2 px podkreślenie `--accent`. Moduły niegotowe: tekst `--muted-2` + pill „Wkrótce" (zamiast szarego, nieklikalnego linku bez wyjaśnienia).
- **Card**: `--surface`, border 1 px `--border`, radius 16 px, cień `card`. Nagłówek karty z separatorem.
- **KPI tile**: label (13 px muted) → wartość (32 px) → pasek postępu 6 px lub linia „delta". Kafelek bez danych: tło `--paper`, przerywany border, tekst wyjaśniający + pill „Moduł wkrótce". Nie pisz samego „Brak danych".
- **Button**: 40 px, radius 10 px, 700. `primary` = accent/biały, `secondary` = biały/border, `ghost` = tekst accent-ink. Wariant `sm` = 32 px.
- **Pill (status)**: radius 999, 12 px / 700, kropka 6 px przed tekstem. Warianty: ok / warn / acc / off.
- **Table**: wiersze 14 px padding, hover `#FAFAF8`, ostatni wiersz bez dolnej krawędzi; osoba = avatar z inicjałami (32 px, accent-soft) + nazwisko 600.
- **Progress bar**: 6 px, tło `--paper` + border, wypełnienie accent / success / warning.
- **Empty state**: ikona liniowa 28 px w kółku `--accent-soft`, jeden nagłówek, jedno zdanie, jeden przycisk primary. Nie zostawiaj pustej tabeli z „Brak danych do wyświetlenia".

## Ikony

Ikony liniowe (stroke 2 px, zaokrąglone końce) — np. Lucide. Bez emoji w interfejsie (obecny „Czy wiedziałeś?" z sową i ikony avatarów zastępujemy inicjałami lub ikonami Lucide).

## Czego nie robić

- Nie używać gradientów, cieni kolorowych ani obrazków „stockowych".
- Nie mieszać zieleni marki (stara CyberSzkoło) z nowym fioletem — zieleń tylko jako status success.
- Nie stosować Inter/Roboto/Arial jako fontu UI.
