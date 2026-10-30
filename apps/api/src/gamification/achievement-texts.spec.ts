import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContentLocale } from '@cyberszkolo/content';
import { SECRET_ICON_FILES, localizedIcon } from './achievement-texts';

const achievements = join(__dirname, '..', '..', '..', 'web', 'public', 'achievements');
const LOCALES: ContentLocale[] = ['pl', 'en'];

describe('localizedIcon: tajne trofea pod nazwą z hashem treści (B-155)', () => {
  it.each(Object.entries(SECRET_ICON_FILES))('%s: API podaje nazwę z hashem, plik istnieje, hash zgadza się z treścią', (icon, files) => {
    for (const locale of LOCALES) {
      const name = files[locale];
      expect(localizedIcon(icon, locale)).toBe(`${locale}/${name}`);
      const bytes = readFileSync(join(achievements, locale, `${name}.svg`), 'utf8').replace(/\r\n/g, '\n');
      expect(name).toBe(`${icon}-${createHash('sha256').update(bytes, 'utf8').digest('hex').slice(0, 8)}`);
    }
  });

  it('stara, przewidywalna nazwa nie istnieje, a w katalogu jest po jednym pliku trofeum (bez starych hashy)', () => {
    for (const locale of LOCALES) {
      const files = readdirSync(join(achievements, locale));
      for (const icon of Object.keys(SECRET_ICON_FILES)) {
        expect(existsSync(join(achievements, locale, `${icon}.svg`))).toBe(false);
        expect(files.filter((file) => file.startsWith(`${icon}-`))).toHaveLength(1);
      }
    }
  });

  it('każdy plik trofeum z hashem ma wpis w mapie (nowe tajne trofeum nie zostanie zepsutym obrazkiem)', () => {
    for (const locale of LOCALES) {
      const known = new Set(Object.values(SECRET_ICON_FILES).map((files) => `${files[locale]}.svg`));
      const hashed = readdirSync(join(achievements, locale)).filter((file) => /-[0-9a-f]{8}\.svg$/.test(file));
      expect(hashed.sort()).toEqual([...known].sort());
    }
  });

  it('jawne odznaki i nazwy spoza wzorca bez zmian', () => {
    expect(localizedIcon('osiagniecie-pierwsza-sprawa', 'pl')).toBe('pl/osiagniecie-pierwsza-sprawa');
    expect(localizedIcon('../zla-nazwa', 'pl')).toBe('../zla-nazwa');
    expect(localizedIcon(null, 'en')).toBeNull();
  });
});
