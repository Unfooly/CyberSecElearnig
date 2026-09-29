import { ContentValidationError, toClientBlock } from './index';
import { fullModule, fullModuleV6 } from './fixtures';
import { noteItemsOf, parseModule } from './node';

// OSINT (D-120, moduł 2 faza 1d): strona z obszarami - użyte przez oszusta (sekret) i pułapki, nagranie przy obszarze z ukrytym zakończeniem.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = Record<string, any>;

const errorsOf = (module: unknown): string => {
  try {
    parseModule(module);
  } catch (e) {
    return (e as ContentValidationError).issues.join('\n');
  }
  return '';
};
const mutate = (change: (m: AnyModule) => void): AnyModule => {
  const m = fullModuleV6() as AnyModule;
  change(m);
  return m;
};
const osint = (m: AnyModule) => m.blocks.find((b: AnyModule) => b.type === 'OSINT_SPOT');
const spot = (m: AnyModule, id: string) => osint(m).spots.find((s: AnyModule) => s.id === id);

describe('OSINT_SPOT: walidacja', () => {
  it('fixtura v6 przechodzi; blok wymaga schemaVersion 6', () => {
    expect(errorsOf(fullModuleV6())).toBe('');
    const m = fullModule() as AnyModule;
    const block = osint(fullModuleV6());
    for (const s of block.spots) {
      if (s.note) s.note.kind = 'item';
      delete s.media;
    }
    m.blocks.splice(m.blocks.length - 1, 0, block);
    expect(errorsOf(m)).toContain('blok OSINT_SPOT wymaga schemaVersion 6');
  });

  it('co najmniej jeden obszar użyty; notatka tylko przy użytym, wyjaśnienie pułapki tylko przy nieużytym', () => {
    expect(errorsOf(mutate((m) => osint(m).spots.forEach((s: AnyModule) => { s.used = false; delete s.note; })))).toContain('co najmniej jeden obszar z used: true');
    expect(errorsOf(mutate((m) => (spot(m, 'godziny').note = { text: 'x', kind: 'web' })))).toContain('note (dowód) tylko przy obszarze użytym');
    expect(errorsOf(mutate((m) => (spot(m, 'zespol').trapText = 'x')))).toContain('trapText tylko przy pułapce');
    expect(errorsOf(mutate((m) => delete spot(m, 'zespol').note.kind))).toContain('dowód wymaga rodzaju notatki');
  });

  it('obszary w granicach, unikalne id, nagranie z rolą głosu, unikalne ukryte zakończenia', () => {
    expect(errorsOf(mutate((m) => (spot(m, 'adres').x = 80)))).toContain('(adres): obszar wychodzi poza grafikę');
    expect(errorsOf(mutate((m) => (spot(m, 'adres').id = 'godziny')))).toContain('spots: powtórzony identyfikator "godziny"');
    expect(errorsOf(mutate((m) => delete spot(m, 'webinar').media.narration.voice))).toContain('nagranie wymaga roli głosu');
    expect(errorsOf(mutate((m) => delete spot(m, 'webinar').media.alt))).toContain('kadr odtwarzacza (image) wymaga opisu alt');
    expect(errorsOf(mutate((m) => delete spot(m, 'webinar').media.image))).toContain('wariant pionowy wymaga image');
    expect(errorsOf(mutate((m) => delete spot(m, 'webinar').media.textLayer[0].portrait))).toContain('kadr z imagePortrait wymaga prostokąta portrait');
    expect(
      errorsOf(
        mutate((m) => {
          spot(m, 'zespol').media = { ...spot(m, 'webinar').media };
        }),
      ),
    ).toContain('powtórzone ukryte zakończenie "off-the-record"');
  });

  it('wariant pionowy: grafika i obszary razem, te same id, w granicach; napisy z prostokątem pionowym', () => {
    expect(errorsOf(mutate((m) => delete osint(m).portraitSpots))).toContain('imagePortrait i portraitSpots występują razem');
    expect(errorsOf(mutate((m) => osint(m).portraitSpots.pop()))).toContain('portraitSpots: brak obszaru "adres"');
    expect(errorsOf(mutate((m) => (osint(m).portraitSpots[0].id = 'nie-ma')))).toContain('portraitSpots: nieznany obszar "nie-ma"');
    expect(errorsOf(mutate((m) => (osint(m).portraitSpots[0].y = 95)))).toContain('portraitSpots[0] (zespol): obszar wychodzi poza grafikę');
    expect(errorsOf(mutate((m) => delete osint(m).textLayer[0].portrait))).toContain('strona z imagePortrait wymaga prostokąta portrait');
  });
});

describe('OSINT_SPOT: noteItemsOf i projekcja', () => {
  it('dowody: użyte obszary z notatką (bez użytego bez notatki i bez pułapek), ukryte do zebrania', () => {
    expect(noteItemsOf(osint(fullModuleV6())).map((item) => [item.id, item.hidden])).toEqual([
      ['zespol', true],
      ['webinar', true],
    ]);
  });

  it('toClientBlock: położenie, podpisy, nagranie i ukryte zakończenie - bez used, notatek, pułapek i kary', () => {
    const block = toClientBlock(osint(fullModuleV6()), { shuffleSeed: () => [1, 2, 3, 4], opaqueId: (b, i) => `${b}-${i}` }) as AnyModule;
    expect(block.spots[0]).toEqual({ id: 'zespol', label: 'Paweł, IT', x: 8, y: 30, w: 26, h: 34 });
    expect(block.spots[2].media.secretEnding).toEqual({ id: 'off-the-record', label: 'Off the Record', note: 'Na końcu webinaru padło to, czego nie powinno.' });
    const json = JSON.stringify(block);
    for (const secret of ['used', 'trapText', 'falseSpotPenalty', 'dowod-zespol', 'pulapka']) expect(json).not.toContain(secret);
  });
});
