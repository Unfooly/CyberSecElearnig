import { ContentLocale, Localized, localizeContent } from '@cyberszkolo/content';
import { ACHIEVEMENT_CODES } from './gamification.constants';

/**
 * Nazwy, opisy i warunki osiągnięć w języku szkoleń gracza (poprawki m3, pkt c; bez migracji - decyzja właściciela 2026-10-19).
 * Tabela `badges` trzyma jedną wersję tekstu (nazwa EN, opis i warunek PL, D-111) - tu jest komplet per język; kod spoza mapy
 * (np. wycofane odznaki) dostaje teksty z bazy. Ten sam język co treść kursu (D-133: konto > przeglądarka > EN), także dla grafiki
 * odznaki (`localizedIcon`: wersje z kompozytora w public/achievements/<język>/). Tytuły spraw w warunkach zostają po polsku - moduły
 * są dziś tylko po polsku. Nazwy PL zaakceptowane przez właściciela (D-146); teksty EN opisów i warunków - robocze, do przeglądu przy wersji EN.
 */
interface AchievementTexts {
  title: Localized<string>;
  description: Localized<string>;
  conditionText: Localized<string>;
}

export const ACHIEVEMENT_TEXTS: Record<string, AchievementTexts> = {
  [ACHIEVEMENT_CODES.FIRST_CASE_CLOSED]: {
    title: { pl: 'Pierwsza sprawa zamknięta', en: 'First Case Closed' },
    description: { pl: 'Twoja pierwsza zamknięta sprawa.', en: 'Your first closed case.' },
    conditionText: { pl: 'Ukończ dowolne szkolenie.', en: 'Complete any training.' },
  },
  [ACHIEVEMENT_CODES.FLAWLESS_CASE]: {
    title: { pl: 'Sprawa bez skazy', en: 'Flawless Case' },
    description: { pl: 'Zamknąłeś sprawę bez jednego przeoczonego śladu.', en: 'You closed the case without missing a single clue.' },
    conditionText: {
      pl: 'Zbierz wszystkie dowody (23/23) i zdobądź 100% za zadania w jednym podejściu do sprawy „Wyłudzone hasło”.',
      en: 'Collect all evidence (23/23) and score 100% on the tasks in a single attempt at the case „Wyłudzone hasło”.',
    },
  },
  [ACHIEVEMENT_CODES.CURIOUS_DETECTIVE]: {
    title: { pl: 'Ciekawski detektyw', en: 'Curious Detective' },
    description: {
      pl: 'Otworzyłeś podejrzaną grę na pulpicie Anny. Na szczęście tylko w ćwiczeniu.',
      en: 'You opened the suspicious game on Anna’s desktop. Luckily, only in a training exercise.',
    },
    conditionText: {
      pl: 'Otwórz podejrzaną grę na pulpicie Anny w sprawie „Wyłudzone hasło”.',
      en: 'Open the suspicious game on Anna’s desktop in the case „Wyłudzone hasło”.',
    },
  },
  [ACHIEVEMENT_CODES.DEAD_AIR]: {
    title: { pl: 'Cisza na linii', en: 'Dead Air' },
    description: { pl: 'Rozłączyłeś się, zanim oszust zdążył cokolwiek wyciągnąć.', en: 'You hung up before the scammer could get anything out of you.' },
    conditionText: {
      pl: 'W rozmowie na żywo w sprawie „Głos z helpdesku” zakończ rozmowę dobrze w najwyżej trzech odpowiedziach, nie podając niczego.',
      en: 'In the live call in the case „Głos z helpdesku”, end the call well within three replies at most, without giving anything away.',
    },
  },
  [ACHIEVEMENT_CODES.PERFECT_PITCH]: {
    title: { pl: 'Słuch absolutny', en: 'Perfect Pitch' },
    description: { pl: 'Wyłapałeś każdą manipulację. Bez jednego fałszywego alarmu.', en: 'You caught every manipulation. Not a single false alarm.' },
    conditionText: {
      pl: 'W odsłuchu nagrania w sprawie „Głos z helpdesku” zaznacz wszystkie czerwone flagi bez żadnego fałszywego alarmu.',
      en: 'While listening to the recording in the case „Głos z helpdesku”, flag every red flag without a single false alarm.',
    },
  },
  [ACHIEVEMENT_CODES.FULL_TRANSCRIPT]: {
    title: { pl: 'Pełny zapis', en: 'Full Transcript' },
    description: { pl: 'Cała rozmowa rozpisana co do słowa. Sprawa bez luk.', en: 'The whole conversation transcribed word for word. A case with no gaps.' },
    conditionText: {
      pl: 'Zbierz wszystkie dowody (także ukryte) i zdobądź 100% za zadania w jednym podejściu do sprawy „Głos z helpdesku”.',
      en: 'Collect all evidence (hidden ones too) and score 100% on the tasks in a single attempt at the case „Głos z helpdesku”.',
    },
  },
  [ACHIEVEMENT_CODES.OFF_THE_RECORD]: {
    title: { pl: 'Poza protokołem', en: 'Off the Record' },
    description: {
      pl: 'Wysłuchałeś webinaru do końca i usłyszałeś to, czego nie powinno tam być.',
      en: 'You listened to the webinar to the end and heard what shouldn’t have been there.',
    },
    conditionText: {
      pl: 'Wysłuchaj do końca webinaru na stronie firmy w sprawie „Głos z helpdesku”.',
      en: 'Listen to the webinar on the company website to the end in the case „Głos z helpdesku”.',
    },
  },
};

/** Etykieta tajnego osiągnięcia w rankingu (przypięte, niezdobyte przez oglądającego). */
export const SECRET_ACHIEVEMENT_LABEL: Localized<string> = { pl: 'Tajne osiągnięcie', en: 'Secret achievement' };

/** Teksty odznaki w języku gracza; kod spoza mapy - teksty z bazy (bez zmian). */
export function localizedBadgeTexts(
  badge: { code: string; title: string; description: string; conditionText: string | null },
  locale: ContentLocale,
): { title: string; description: string; conditionText: string | null } {
  const texts = ACHIEVEMENT_TEXTS[badge.code];
  if (!texts) return { title: badge.title, description: badge.description, conditionText: badge.conditionText };
  return {
    title: localizeContent(texts.title, locale),
    description: localizeContent(texts.description, locale),
    conditionText: localizeContent(texts.conditionText, locale),
  };
}

/**
 * Grafika odznaki w języku gracza: nazwa pliku z bazy z katalogiem języka („pl/osiagniecie-pierwsza-sprawa”) - web składa z niej
 * /achievements/<język>/<nazwa>.svg (achievementImage). Nazwa spoza wzorca - bez zmian (web i tak jej nie pokaże).
 */
export function localizedIcon(icon: string | null, locale: ContentLocale): string | null {
  return icon && /^[a-z0-9-]{1,80}$/.test(icon) ? `${locale}/${icon}` : icon;
}
