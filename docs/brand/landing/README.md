# Unfooly — strona główna (landing page)

`index.html` to statyczny mockup w HTML/CSS (Plus Jakarta Sans z Google Fonts, logo inline SVG). Podgląd: `preview.png`.

## Prompt dla Claude Code

Zbuduj publiczną stronę główną Unfooly w Next.js na podstawie `docs/brand/landing/index.html` i `docs/brand/BRAND.md`.
Struktura sekcji, copy i kolejność jak w mockupie: nav → hero ze zrzutem dashboardu → „Dlaczego Unfooly" (3 karty) → „Jak to działa" (3 kroki) → funkcje (6 kafelków, dwa z pillem „Wkrótce") → pas „Zgodność" (ciemny) → „Dla kogo" → cennik z formularzem demo → CTA końcowe → stopka.
- Route `/` (publiczny), zalogowani przekierowani do `/dashboard`.
- Zrzut dashboardu w hero: prawdziwy komponent z aplikacji w trybie „demo" (statyczne dane), nie obrazek.
- Formularz „Umów demo": e-mail + liczba pracowników, wysyłka na [ADRES E-MAIL SPRZEDAŻY] przez istniejący moduł e-mail; walidacja; komunikat sukcesu w `--success-soft`.
- Cennik: wartości `[CENA]` i `[KWOTA]` jako stałe w jednym pliku konfiguracyjnym, do uzupełnienia.
- Responsywność: 1440 → 1024 → 390 px; poniżej 1024 hero w jednej kolumnie, siatki 3→2→1.
- SEO: `<title>`, `description`, OG image z `logo/png/unfooly-wordmark-1600.png`, favicon z `logo/`.
- Nie używaj gradientów ani emoji; ikony Lucide.
