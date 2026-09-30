# Kompozytor scen (scripts/content/scenes)

Scena szkoleniowa to plik JSON z listą klocków. Skrypt składa z nich SVG w płaskim stylu Unfooly
i **sam wylicza hotspoty** (procenty względem obrazu), więc nikt nie przelicza
współrzędnych ręcznie. Docelowe miejsce w repo: `scripts/content/scenes/`
(ten sam projekt npm co skrypt TTS: tsx + vitest, zero zależności runtime).

## Użycie

```
# lista klocków
npx tsx scenes/cli.ts props

# scena -> SVG + hotspots.json (+ podgląd z ramkami)
npx tsx scenes/cli.ts build packages/content/modules/<slug>/scenes/biuro-anny.json \
  --out packages/content/modules/<slug>/assets/scenes --preview

# to samo + podmiana x/y/w/h hotspotów w module.json (po id)
npx tsx scenes/cli.ts build .../biuro-anny.json --out .../assets/scenes \
  --module packages/content/modules/<slug>/module.json --block scena-biuro

# to samo, ale dla hotspotów WEWNĄTRZ zagnieżdżonej sceny (media.kind: "scene") jednego
# hotspotu bloku --block, zamiast hotspotów najwyższego poziomu (B-086/D-071)
npx tsx scenes/cli.ts build .../pulpit.json --out .../assets/scenes \
  --module packages/content/modules/<slug>/module.json --block scena-biuro --nested monitor
```

`--preview` tworzy `*.preview.html` z czerwonymi ramkami hotspotów — do obejrzenia,
nie do repo (`.gitignore`: `*.preview.html`).

## Format sceny

```json
{
  "width": 1600, "height": 1000,
  "background": { "floorY": 780 },      // albo { "flat": true, "wall": "#4E40B8" } — jednolite tło bez podłogi (pulpit, zbliżenia)
  "items": [
    { "id": "kalendarz", "prop": "calendar", "x": 1280, "y": 120, "hotspot": true,
      "params": { "month": "WRZESIEŃ", "markedDay": 15, "note": "PRZELEWY DO 15:00 !!!" } },
    { "id": "monitor", "prop": "monitor", "x": 480, "y": 280, "hotspot": true,
      "partHotspots": { "sticky": "karteczka" },
      "params": { "screen": "mail", "sticky": ["Unfooly24!", "bank: to samo"] } },
    { "id": "roslina", "prop": "plant", "x": 1410, "y": 600 }
  ]
}
```

- `id` — kebab-case; gdy `hotspot: true`, to jest id hotspotu w `module.json`.
- `hotspot: "część"` — hotspotem jest tylko część klocka (np. karteczka na monitorze).
- `partHotspots: { część: id }` — dodatkowe hotspoty z części pod własnymi id.
- `scale` — skala klocka (hotspot liczy się po skalowaniu). `pad` — margines w px (domyślnie 8).
- Kolejność w `items` = kolejność rysowania (późniejszy przykrywa wcześniejszy).

## Klocki

| prop | parametry | części |
|---|---|---|
| `window` | `w, h, sun` | |
| `calendar` | `month, markedDay, markedCell [r,c], note` | |
| `shelf` | `binders: kolory[]` | |
| `whiteboard` | `w, h, lines[]` (1. linia = tytuł) | |
| `door` | `open, label` | |
| `wallSign` | `text, arrow: left\|right\|none` | |
| `noticeBoard` | `w, h, title, notes[] ("tytuł|podtytuł", max 4)` | |
| `desktopIcon` | `icon: outlook\|trash\|folder\|browser\|game\|sheet, label, badge` (`game` - własna ikona gry, bez cudzych logotypów) | |
| `taskbar` | `w, clock, date` | |
| `mailWindow` | `from, to, date, subject, attachment, body[] ("!" = czerwona linia), button, link, footer[]` | |
| `paper` | `title, lines[] ("etykieta|wartość"), stamp` | |
| `desk` | `w, legs` | |
| `drawerUnit` | `drawers` | |
| `chair`, `plant`, `keyboardMouse` | — | |
| `monitor` | `screen: mail\|login\|locked\|blank\|spreadsheet, subject, sender, button, title, sticky[]` | `sticky` |
| `laptop` | jak `monitor` bez `sticky` | |
| `stickyNote` | `lines[] (max 3), color` | |
| `phone` | `led, display[] (2), note, body` | |
| `printer` | `paper, paperText, ready` | |
| `mug` | `label[] (2), color, steam` | |
| `smartphone` | `lines[] (3), badge` | |
| `box` | `w, h, label` | |

### Klocki odprawy (`props-odprawa.ts`, widok z góry na biurko, D-084)

Zarejestrowane w tym samym `PROPS` (`...ODPRAWA_PROPS`). Sceny 1600×900 z jednolitym tłem biurka
(`"background": { "flat": true, "wall": "#D9C3A5" }`); źródła: `examples/wyludzone-haslo/odprawa-*.json`. Części `slot-*` to miejsca, w które
odtwarzacz wstawia HTML (zadania, dane gracza) - ich współrzędne (`*.hotspots.json`) trafiają do `steps[].slots` bloku BRIEFING.

| prop | parametry | części |
|---|---|---|
| `woodGrain` | `w, h` | |
| `phoneTop` | `state: ringing\|call\|idle, animated, caller, role, initials, timer` | `screen` |
| `mugTop`, `penTop` | `color` | |
| `coffeeRing`, `glassesTop`, `magnifier`, `laptopTopClosed` | — | |
| `notepadTop` | `lines[] (max 4)` | |
| `keysTop` | `tag` | |
| `newspaper` | `title, headline[] (2)` | |
| `caseFolderClosed` | `caseNo, stamp` | `cover` |
| `caseFolderOpen` | `caseNo, title, victim, victimRole, loss, when, reporter, stamp` | `slot-zadania` |
| `badgeWallet` | `unit` | `slot-zdjecie`, `slot-imie`, `slot-numer` |

Warianty pionowe (telefon, D-098): sceny 900×1600 (`examples/<slug>/*-pion.json`, `PION_PROPS`), ich współrzędne trafiają do
`steps[].portrait` bloku BRIEFING i `closing.portrait` (test w `odprawa.test.ts` pilnuje zgodności z `*-pion.hotspots.json`):

| prop | parametry | części |
|---|---|---|
| `stackedHalves` | `prop` (klocek poziomy, domyślnie `caseFolderOpen`), `params`, `gap` | części klocka źródłowego (prawa połowa przesunięta pod lewą) |
| `badgeWalletPortrait` | `unit` | `slot-zdjecie`, `slot-imie`, `slot-numer` |

Oba składają inne klocki przez rejestr `prop-registry.ts` (`registeredProp`, wypełniany w `props.ts` po zbudowaniu `PROPS`) - nie
cyklicznym importem `PROPS` (kolejność importów modułów nie ma znaczenia). Nieznana nazwa klocka, klocek składający sam siebie albo
część przecinająca środek klocka (`stackedHalves`) to czytelny błąd.

`phoneTop` w stanie `ringing` dzwoni (klasy animacji `a-ring`, `a-wave`, `a-grow`; `animated: false` je wyłącza). Test
`odprawa.test.ts` pilnuje, że build KAŻDEJ sceny z `examples/<cel>/*.json` daje identyczny plik i identyczne `*.hotspots.json`
(B-128: jeden katalog na cel - `examples/<slug>/` dla modułu, wynik w `packages/content/modules/<slug>/assets/scenes` albo `assets/`
dla miniatury; `examples/achievements/` dla trofeów, wynik w `apps/web/public/achievements`), i że każda grafika w tych katalogach ma
źródło. Nowy moduł = nowy katalog `examples/<slug>/`, test obejmuje go sam. Po zmianie klocka albo kompozytora przebuduj sceny
(`cli.ts build examples/<slug>/<scena>.json --out <assets>/scenes`) i opublikuj (`--assets`).

### Klocki modułu 2 (`props-helpdesk.ts`, „Głos z helpdesku”, D-125)

Zarejestrowane w `PROPS` (`...HELPDESK_PROPS`), dostarczone przez grafika (paczki 1 i 2). Zasada EN-ready: grafiki bez słów - napisy
dokłada odtwarzacz (`textLayer`, sloty `slot-*`); w grafice tylko cyfry i numery zamaskowane (12 3XX XX 41, 214). Źródła scen:
`examples/glos-z-helpdesku/*.json` (sceny, zbliżenia, warianty `-pion`; legitymacja i pieczęć jak w module 1), trofea:
`examples/achievements/osiagniecie-{cisza-na-linii,czysty-odsluch,pelny-zapis,off-the-record}*.json`. Współrzędne hotspotów i slotów
warstwy tekstu w `module.json` pochodzą z `*.hotspots.json` (źródło prawdy); wyjątki - napisy bez slotu od grafika (strona „Zespół”,
podpisy ikon pulpitu, hasło plakatu) mają współrzędne wpisane ręcznie w granicach swojego obszaru (D-125).

| prop | do czego |
|---|---|
| `phoneFaceUp`, `phoneHomeTiles`, `phoneLying`, `stickyLying`, `noCodePoster`, `monitorRemote` | biurko Karola (scena, telefon, karteczka, plakat, monitor) |
| `mfaListZoom`, `callLogZoom` | zbliżenia: seria powiadomień MFA, rejestr połączeń |
| `desktopRemoteIcon`, `remoteToolWindow` | pulpit z narzędziem zdalnej pomocy |
| `recorderTop`, `headphonesTop`, `transcriptPagesTop`, `highlighterTop` | sala odsłuchu (tło nagrania i omówienia) |
| `adminConsoleWindow` | konsola administratora |
| `callCompareTop`, `intranetSheet` | porównanie w rejestrze połączeń |
| `teamWebsite`, `webinarFrame` | strona „Zespół” (OSINT) i kadr webinaru |
| `incomingCallScreen` | ekran połączenia przychodzącego (rozmowa na żywo) |
| `avatarBust` | awatary postaci przesłuchań |
| `trophyHelpdesk` | trofea osiągnięć modułu 2: `kind` `dead-air`, `perfect-pitch`, `full-transcript`, `off-the-record`, `earned` (zablokowane bez nazw) |

`caseFolderOpen` przyjmuje `victimLabel` (domyślnie „Poszkodowana”), a `reportFolderOpen` - listę `bags` (domyślnie torebki modułu 1);
domyślne wartości zostawiają sceny modułu 1 bajt w bajt bez zmian (test `odprawa.test.ts`).

### Przezroczyste tło grafik otwieranych kliknięciem (D-101)

`"background": { "flat": true, "wall": "none" }` - scena bez prostokąta tła (tylko z `flat`). Narzędzia (z `scripts/content`):
`npx tsx scenes/crop-zooms.ts scenes/examples/<slug> <scena...>` (zbliżenie przedmiotu/dokumentu/okna: przezroczyste tło, ciasny kadr jedynego
elementu) i `npx tsx scenes/wrap-in-monitor.ts scenes/examples/<slug> <scena...>` (ekran komputera w ramce monitora `screenFrame`, tapeta = dawny
kolor tła). Zmieniają tylko tło, kadr i przesunięcia; są idempotentne (logika: `scene-tools.ts`, testy: `scene-tools.test.ts`). Klocek,
który rysuje coś NAD swoim pudełkiem (para z kubka, taśma karteczki), musi być w `OVERFLOW_TOP` - inaczej kadr go utnie. Reguła i test
w CI: `docs/content/MODULE-PLAYBOOK.md`.

| prop | parametry | części |
|---|---|---|
| `screenFrame` | `sw, sh` (ekran), `wallpaper` (#rgb/#rrggbb), `bezel` | |
| `mailWindowPortrait` | jak `mailWindow` (okno maila w pionie, duży zawijany tekst, D-104) | |
| `browserHistoryPortrait` | `rows[]` jak `browserHistory` („!” = wiersz wyróżniony) | |
| `reportPortrait` | `caseNo, title, bags[]` (raport zamknięcia jako jedna strona) | `slot-dowody`, `slot-czas`, `slot-xp`, `slot-wnioski`, `slot-podpis`, `slot-pieczec`, `slot-liscik` |

## Animacje

Każda scena ma na `<svg>` `id="static"` i blok `<style>` z animacjami CSS (`ANIM_CSS` w `compose.ts`); klocki dostają klasy
`a-blink`, `a-blink-slow`, `a-glow`, `a-pulse`, `a-steam`, `a-sway`, `a-flutter`, `a-bounce`, `a-ring`, `a-wave`, `a-grow`,
`a-shimmer` (opóźnienia `d1`, `d2`). Animacje działają też w `<img>` (bez skryptów). Zatrzymują je `prefers-reduced-motion` w samym
SVG oraz fragment `#static` w adresie obrazu (`#static:target`) - odtwarzacz dopisuje go przy reduced-motion do każdego obrazu sceny,
więc nie trzeba osobnych wariantów statycznych. Tylko `opacity`/`transform` - kształty i hotspoty się nie przesuwają.

Nowy klocek = jedna funkcja w `props.ts` zwracająca `{ svg, w, h, parts? }` w lokalnych
współrzędnych od (0,0) + wpis w `PROPS` + wiersz w tej tabeli. Test „każdy klocek renderuje
się z domyślnymi parametrami" łapie brakujące domyślne.

## Zasady bezpieczeństwa

- Cały tekst z JSON jest escapowany; SVG nie zawiera `<script>`, `on*=`, `href`, `foreignObject`
  ani `javascript:` — test to sprawdza. Lint SVG ze skryptu TTS (`--assets`) i tak przejdzie.
- Animacje to wyłącznie CSS w `<style>` sceny (bez SMIL i bez skryptów). Lint SVG (`--assets`) odrzuca w CSS `@import` i `url(...)`
  z zewnętrznym adresem.
- Id `clipPath` są prefiksowane id elementu, więc dwa monitory w jednej scenie nie kolidują.

## Paleta

`palette.ts` — te same kolory co maskotka: `ink #2B2440`, `purple #6C5CE7`, `orange #F0883A`
i neutralne. Nowe klocki używają wyłącznie `P.*`.
