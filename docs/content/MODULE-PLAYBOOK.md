# Playbook modułu szkoleniowego

Zasady tworzenia treści modułów (`packages/content/modules/<slug>`), które obowiązują każdy nowy moduł i każdą zmianę grafik. Format
treści i walidacja: `packages/content/README.md`; potok nagrań i zasobów: `docs/content-pipeline.md`; kompozytor scen:
`scripts/content/scenes/README.md`; odtwarzacz: `docs/course-player.md`.

## Grafiki otwierane kliknięciem mają przezroczyste tło (D-101)

Każda grafika otwierana kliknięciem (zbliżenie przedmiotu, dokument, okno, ekran) ma przezroczyste tło:

- **przedmioty, dokumenty, okna** → `scripts/content/scenes/crop-zooms.ts` (`wall: 'none'`, ciasny kadr wokół jedynego elementu sceny);
- **ekrany komputera** (pulpit, okno aplikacji na monitorze) → `scripts/content/scenes/wrap-in-monitor.ts` (ramka monitora `screenFrame`,
  tapeta = dawny kolor tła, tło wokół przezroczyste).

Odtwarzacz pokazuje taką grafikę bez karty, z samym cieniem po kształcie (`drop-shadow`), max 88% sceny, na przyciemnionej i
rozmytej scenie (ink 35% + blur 3 px, D-102).

Kolejność pracy dla nowej albo zmienionej grafiki:

```
cd scripts/content
npx tsx scenes/crop-zooms.ts scenes/examples <scena> [...]        # albo wrap-in-monitor.ts dla ekranów
npx tsx scenes/cli.ts build scenes/examples/<scena>.json --out ../../packages/content/modules/<slug>/assets/scenes
# ekran z hotspotami: przepisz współrzędne z <scena>.hotspots.json do module.json
npm run tts -- <slug> --assets --storage r2 --yes                  # publikacja z gałęzi PR
npm run tts -- <slug> --assets --check
```

Obie komendy kompozytora zmieniają wyłącznie tło, kadr i przesunięcia - treść sceny zostaje nietknięta; są idempotentne.

**Test w CI** (`scripts/content/scenes/transparent-zooms.test.ts`): każdy plik z `media.src` (image), `media.image` (zbliżenie nad
nagraniem) i `media.scene.image` - także w scenie zagnieżdżonej - we WSZYSTKICH modułach jest SVG bez prostokąta tła na całą scenę
albo jest owinięty ramką monitora.
