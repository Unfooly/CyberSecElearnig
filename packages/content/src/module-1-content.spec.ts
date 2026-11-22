import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toClientBlock } from './index';
import { moduleWarnings, parseModule } from './node';

// Moduł 1 „Zabawa w phishing”, scenariusz „Webinar” (D-176, docs/modules/modul-1-zabawa-w-phishing-webinar.md, zaakceptowany przez
// właściciela 2026-11-19): kolejność bloków, mechaniki z nagrania (lista cech maila, czat, domena z podpowiedziami, Tak/Nie, rozmowa,
// tablica, raport, gazeta przed ekranem końca), easter egg odznaki „Ciekawski detektyw”, fikcyjne nieistniejące domeny, klucz odpowiedzi
// nie idzie do klienta. Dawna treść modułu 1 pilnowana jest jako moduł podglądu `dev-modul-1` (golden test, D-175).
const MODULE_1 = join(__dirname, '..', 'modules', 'wyludzone-haslo', 'module.json');
const raw = JSON.parse(readFileSync(MODULE_1, 'utf8'));
const parsed = parseModule(raw);
const block = (id: string) => parsed.blocks.find((b) => b.id === id)! as unknown as Record<string, unknown>;
const context = { shuffleSeed: () => [1, 2, 3, 4] as [number, number, number, number], opaqueId: (blockId: string, itemId: string) => `x${blockId}-${itemId}` };

describe('moduł 1 „Zabawa w phishing” - scenariusz „Webinar”', () => {
  it('waliduje się bez ostrzeżeń: v6, tylko po polsku, tryb pełny, slug i tytuł bez zmian', () => {
    expect(parsed.schemaVersion).toBe(6);
    expect(parsed.locales).toEqual(['pl']);
    expect(parsed.simpleMode).toBeUndefined();
    expect(parsed.slug).toBe('wyludzone-haslo');
    expect(parsed.title).toBe('Zabawa w phishing');
    expect(parsed.caseNumber).toBe(1);
    expect(parsed.startNotice).toMatch(/^Przed rozpoczęciem tego modułu/);
    expect(moduleWarnings(parsed)).toEqual([]);
  });

  it('kolejność bloków ze scenariusza; gazeta tuż przed podsumowaniem (ekranem końca)', () => {
    expect(parsed.blocks.map((b) => `${b.id}:${b.type}`)).toEqual([
      'teczka:TABS',
      'biuro-pawla:SCENE_HOTSPOTS',
      'pulpit:SCENE_HOTSPOTS',
      'zaproszenie:EMAIL_ANALYSIS',
      'biuro-pawla-2:SCENE_HOTSPOTS',
      'telefon:SCENE_HOTSPOTS',
      'komunikator:DOSSIER',
      'pulpit-2:SCENE_HOTSPOTS',
      'domena:TEXT_INPUT_GUIDED',
      'zaufanie:QUIZ',
      'biuro-pawla-3:SCENE_HOTSPOTS',
      'rozmowa-pawel:DIALOGUE',
      'tablica:ORDERING',
      'raport:TABS',
      'gazeta:SCENE_HOTSPOTS',
      'zasady:SUMMARY',
    ]);
  });

  it('bloki oceniane i wagi: mail 2, zaufanie 1, tablica 2; domena 0 (ćwiczenie prowadzone, D-181); reszta nieoceniana', () => {
    const weights = Object.fromEntries(parsed.blocks.filter((b) => (b.weight ?? 0) > 0).map((b) => [b.id, b.weight]));
    expect(weights).toEqual({ zaproszenie: 2, zaufanie: 1, tablica: 2 });
    expect(block('domena').weight).toBe(0);
  });

  it('mail: jedyna poprawna cecha to niespodziewana, atrakcyjna oferta; mail bez linków i załączników', () => {
    const criteria = block('zaproszenie').criteria as { id: string; correct: boolean }[];
    expect(criteria.filter((c) => c.correct).map((c) => c.id)).toEqual(['oferta']);
    const email = block('zaproszenie').email as { links: unknown[]; attachment?: unknown };
    expect(email.links).toEqual([]);
    expect(email.attachment).toBeUndefined();
  });

  it('domena: odpowiedź formularz-online.net (nie poddomena), trzy podpowiedzi krok po kroku', () => {
    const answer = block('domena').answer as { regex: string };
    const re = new RegExp(answer.regex, 'i');
    expect(['formularz-online.net', 'www.formularz-online.net', 'Formularz-Online.net/'].filter((ok) => !re.test(ok))).toEqual([]);
    expect(['fundacja-analityki.formularz-online.net', 'fundacja-analityki.pl', 'online.net'].filter((bad) => re.test(bad))).toEqual([]);
    expect((block('domena').hints as unknown[]).length).toBe(3);
  });

  it('easter egg odznaki „Ciekawski detektyw”: gra na pulpicie komputera Pawła z wyróżnieniem `ciekawski-detektyw`', () => {
    const hotspots = block('pulpit').hotspots as { id: string; media?: { kind: string; badge?: { id: string } } }[];
    const game = hotspots.find((h) => h.id === 'gra')!;
    expect(game.media?.kind).toBe('popups');
    expect(game.media?.badge?.id).toBe('ciekawski-detektyw');
  });

  it('okna jak na nagraniu (D-178): teczka i raport w teczce na biurku, poczta w monitorze, czat w telefonie', () => {
    for (const id of ['teczka', 'raport']) {
      expect(block(id).look).toBe('folder');
      expect(block(id).background).toBeDefined();
    }
    expect(block('zaproszenie').frame).toBe('monitor');
    const chat = (block('komunikator').documents as { layout?: string; self?: string }[])[0];
    expect(chat).toMatchObject({ layout: 'chat', self: 'Paweł' });
    expect(parsed.cover?.backdrop).toBeDefined();
  });

  it('tablica jak na nagraniu (D-182): trzy etapy E-mail → Rozmowa → Link na kartkach z notatkami, tło tablicy z Dreaminy', () => {
    const tablica = block('tablica') as {
      look?: string;
      items: { id: string; text: string }[];
      slots?: { notes: string[] }[];
      background?: string;
      backgroundPortrait?: string;
      start?: unknown;
    };
    expect(tablica.look).toBe('notes');
    expect(tablica.items.map((item) => [item.id, item.text])).toEqual([
      ['mail', 'E-mail'],
      ['rozmowa', 'Rozmowa telefoniczna'],
      ['link', 'Link'],
    ]);
    expect(tablica.slots).toHaveLength(3);
    // Kartka 3 (link) zbiera domenę z bloku „domena” i wpisanie hasła (dawny czwarty etap).
    expect(tablica.slots![2].notes.join(' ')).toContain('formularz-online.net');
    expect(tablica.slots![2].notes.join(' ')).toContain('hasło');
    expect(tablica.background).toMatch(/^assets\/wyludzone-haslo\/images\/tablica-tlo\.[0-9a-f]{8}\.webp$/);
    expect(tablica.backgroundPortrait).toMatch(/^assets\/wyludzone-haslo\/images\/tablica-tlo-pion\.[0-9a-f]{8}\.webp$/);
    expect(tablica.start).toBeUndefined();
  });

  it('poprawki właściciela (D-181): czat na ekranie telefonu ze sceny, domena rozkładana w monitorze, gazeta jako strona gazety', () => {
    // Ten sam telefon co na scenie z ekranem głównym - rozmowa leży na jego ekranie, a nie w osobnym oknie.
    const phone = block('komunikator').phone as { image: string; imagePortrait?: string };
    expect(phone.image).toBe(block('telefon').image);
    expect(phone.imagePortrait).toBe(block('telefon').imagePortrait);
    expect(block('domena')).toMatchObject({ frame: 'monitor', markUrl: 'https://fundacja-analityki.formularz-online.net/prelegenci/48213' });
    // Adres jest w pasku przeglądarki, nie w treści zadania.
    expect(block('domena').prompt).not.toContain('https://');
    const article = (block('gazeta').hotspots as { media?: { look?: string; masthead?: string } }[])[0].media;
    expect(article).toMatchObject({ look: 'newspaper', masthead: 'Kurier Cyfrowy' });
  });

  it('poprawki właściciela, rundy 2-3 (D-184, D-185): zadanie z formularzem startuje kliknięciem Internetu na pulpicie po komunikatorze', () => {
    const ids = parsed.blocks.map((b) => b.id);
    // Po komunikatorze (link) z powrotem przy komputerze Pawła: Poczta ✓, Internet = drzwi do zadania z domeną.
    expect(ids.indexOf('komunikator') + 1).toBe(ids.indexOf('pulpit-2'));
    expect(ids.indexOf('pulpit-2') + 1).toBe(ids.indexOf('domena'));
    const pulpit2 = block('pulpit-2') as { image: string; hotspots: { id: string; action?: string; done?: boolean }[] };
    expect(pulpit2.image).toBe(block('pulpit').image);
    expect(Object.fromEntries(pulpit2.hotspots.map((h) => [h.id, h.done ? 'done' : (h.action ?? 'card')]))).toEqual({ poczta: 'done', internet: 'next' });
    // Na pierwszym pulpicie Internet to tylko zapowiedź (bez strony) - strona otwiera się dopiero razem z zadaniem.
    const internet = (block('pulpit').hotspots as { id: string; media?: unknown }[]).find((h) => h.id === 'internet')!;
    expect(internet.media).toBeUndefined();
    const domena = block('domena') as { markUrl: string; background: string; page: { tabTitle: string; fields: string[] } };
    expect(domena.page).toMatchObject({ tabTitle: 'Formularz prelegenta – rejestracja', fields: ['Służbowy e-mail', 'Hasło'] });
    // Tło zadania to scena pulpitu Pawła (ten sam plik).
    expect(domena.background).toBe(block('pulpit').image);
    // Zdjęcie ofiary przypięte do kartki „Ofiara ataku” w teczce (D-191) - ten sam portret co avatar Pawła w rozmowie.
    const ofiara = (block('teczka').tabs as { id: string; photo?: string; photoAlt?: string }[]).find((tab) => tab.id === 'ofiara')!;
    expect(ofiara.photo).toBe((block('rozmowa-pawel').character as { avatar: string }).avatar);
    expect(ofiara.photoAlt).toContain('Pawła Nowickiego');
    // Zdjęcia w obu teczkach (D-196): każda zakładka teczki sprawy i raportu ma przypiętą ilustrację z opisem.
    for (const id of ['teczka', 'raport']) {
      for (const tab of block(id).tabs as { id: string; photo?: string; photoAlt?: string }[]) {
        expect(`${id}/${tab.id}: ${tab.photo}`).toMatch(/: assets\/wyludzone-haslo\/images\/[a-z-]+\.[0-9a-f]{8}\.webp$/);
        expect((tab.photoAlt ?? '').length).toBeGreaterThan(10);
      }
    }
    // Gazeta (D-195): dłuższy artykuł o Charming Kitten - kim są, kto opisał kampanię, wniosek.
    const artykul = (block('gazeta').hotspots as { id: string; media: { lines: string[] } }[]).find((h) => h.id === 'artykul')!;
    expect(artykul.media.lines.length).toBeGreaterThanOrEqual(8);
    for (const word of ['Charming Kitten', '2014', 'ClearSky', 'Microsoft']) expect(artykul.media.lines.join(' ')).toContain(word);
    // Komentarz do wyniku domeny (D-193): poddomena o dowolnej nazwie i domena bez związku z rzekomym nadawcą - w obu wariantach.
    const reactions = (block('domena').reactions as { result: { when: string; text: string }[] }).result;
    expect(reactions.map((r) => r.when)).toEqual(['correct', 'incorrect']);
    for (const reaction of reactions) {
      // Słowo „subdomena”, nie „poddomena” (D-194) - w całej treści modułu.
      expect(reaction.text).toMatch(/subdomena/);
      expect(reaction.text).toMatch(/dowolną nazwę/);
      expect(reaction.text).toMatch(/nie ma nic wspólnego z rzekomym nadawcą e-maila, Fundacją Analityki Stosowanej/);
    }
    expect(JSON.stringify(parsed)).not.toMatch(/poddomen/i);
    // Napis „Rejestracja” w komunikatorze wygląda jak link (D-192).
    const czat = (block('komunikator').documents as { rows: { id: string; link?: string; cells: string[] }[] }[])[0];
    const linkRow = czat.rows.find((row) => row.id === 'link')!;
    expect(linkRow.link).toBe('Rejestracja');
    expect(linkRow.cells[2].endsWith('Rejestracja')).toBe(true);
    // Pytanie Tak/Nie o link zaraz po domenie, w tym samym widoku (D-190): ta sama strona, adres, tło i ekran co zadanie z domeną.
    const zaufanie = block('zaufanie') as Record<string, unknown>;
    expect(ids.indexOf('domena') + 1).toBe(ids.indexOf('zaufanie'));
    expect(zaufanie.frame).toBe('monitor');
    for (const field of ['markUrl', 'page', 'background', 'backgroundScreen']) expect(zaufanie[field]).toEqual((block('domena') as Record<string, unknown>)[field]);
    // Rozmowa z Pawłem na tym samym telefonie co komunikator.
    expect(block('rozmowa-pawel').phone).toEqual(block('komunikator').phone);
    // Ramka gazety na zdjęciu w artykule (D-185), nie na całym stole.
    expect((block('gazeta').hotspots as { x: number; y: number; width: number; height: number }[])[0]).toMatchObject({ x: 20, y: 20, width: 34, height: 66 });
  });

  it('gazeta na telefonie w całości, bez przesuwania (uwaga właściciela 2026-11-22): wariant pionowy to ta sama grafika z tą samą ramką', () => {
    const gazeta = block('gazeta');
    // Wariant pionowy (D-116) = „contain” bez panoramy; ta sama opublikowana grafika, więc nic nowego do publikacji.
    expect(gazeta.imagePortrait).toBe(gazeta.image);
    expect(gazeta.portraitHotspots).toEqual([{ id: 'artykul', x: 20, y: 20, width: 34, height: 66 }]);
  });

  it('biuro powtarzane jak na nagraniu: komputer → pulpit (Poczta) → mail; ✓ komputer, smartfon → ekran telefonu (Komunikator) → czat; ✓ oba, Paweł → rozmowa', () => {
    const scene = (id: string) =>
      Object.fromEntries((block(id).hotspots as { id: string; action?: string; done?: boolean }[]).map((h) => [h.id, h.done ? 'done' : (h.action ?? 'card')]));
    expect(scene('biuro-pawla')).toEqual({ komputer: 'next', smartfon: 'card', pawel: 'card' });
    expect(scene('pulpit')).toMatchObject({ poczta: 'next' });
    expect(scene('biuro-pawla-2')).toEqual({ komputer: 'done', smartfon: 'next', pawel: 'card' });
    expect(scene('telefon')).toMatchObject({ komunikator: 'next' });
    expect(scene('biuro-pawla-3')).toEqual({ komputer: 'done', smartfon: 'done', pawel: 'next' });
    const ids = parsed.blocks.map((b) => b.id);
    expect(ids.indexOf('pulpit') + 1).toBe(ids.indexOf('zaproszenie'));
    expect(ids.indexOf('telefon') + 1).toBe(ids.indexOf('komunikator'));
    expect(ids.indexOf('biuro-pawla-3') + 1).toBe(ids.indexOf('rozmowa-pawel'));
  });

  it('fikcyjne domeny: tylko fundacja-analityki.pl, formularz-online.net i unfooly.com (sprawdzone 2026-11-19: dwie pierwsze nie istnieją)', () => {
    const text = JSON.stringify(raw);
    const domains = new Set([...text.matchAll(/\b[a-z0-9-]+\.(?:pl|net|com)\b/g)].map((m) => m[0]));
    expect([...domains].sort()).toEqual(['formularz-online.net', 'fundacja-analityki.pl', 'unfooly.com']);
  });

  it('klucz odpowiedzi nie idzie do klienta (toClientBlock): poprawność kryteriów i opcji, odpowiedź i podpowiedzi domeny, kolejność tablicy', () => {
    const client = JSON.stringify(parsed.blocks.map((b) => toClientBlock(b, context)));
    expect(client).not.toContain('formularz-online\\\\.net');
    expect(client).not.toContain('Zacznij od znalezienia pierwszego pojedynczego ukośnika');
    expect(client).not.toContain('"correct"');
    expect(client).not.toContain('Właśnie to: zaproszenie na prelegenta');
  });

  it('podsumowanie: trzy zasady na ekran końca (`lessons`), bez grafiki zamknięcia (D-169: podsumowanie zamyka się samo)', () => {
    expect(block('zasady').lessons).toEqual([
      'Niespodziewana atrakcyjna oferta? Sprawdź ją innym kanałem.',
      'Miła rozmowa to nie dowód tożsamości – możesz się rozłączyć.',
      'Przed logowaniem sprawdź domenę. Hasło tylko na stronach firmy.',
    ]);
    expect(block('zasady').closing).toBeUndefined();
  });

  it('okładki, miniatura, grafiki scen i portret Pawła - opublikowane WebP', () => {
    const key = /^assets\/wyludzone-haslo\/images\/[a-z-]+\.[0-9a-f]{8}\.webp$/;
    expect(parsed.thumbnail).toMatch(key);
    for (const field of ['start', 'end', 'startPortrait', 'endPortrait', 'backdrop'] as const) expect(parsed.cover?.[field]).toMatch(key);
    for (const id of ['biuro-pawla', 'biuro-pawla-2', 'biuro-pawla-3', 'pulpit', 'telefon']) expect(block(id).image).toMatch(key);
    for (const id of ['teczka', 'raport']) expect(block(id).background).toMatch(key);
    expect(block('gazeta').image).toMatch(key);
    expect((block('rozmowa-pawel').character as { avatar: string }).avatar).toMatch(key);
  });
});
