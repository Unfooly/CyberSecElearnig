import { canonicalTimeZone } from './iana-time-zone.validator';

describe('canonicalTimeZone', () => {
  it.each([
    ['Europe/Warsaw', 'Europe/Warsaw'],
    ['europe/warsaw', 'Europe/Warsaw'],
    ['America/Argentina/Buenos_Aires', 'America/Buenos_Aires'], // ICU sprowadza aliasy do nazwy kanonicznej
    ['UTC', 'UTC'],
    ['Asia/Tokyo', 'Asia/Tokyo'],
  ])('"%s" => "%s"', (input, expected) => {
    expect(canonicalTimeZone(input)).toBe(expected);
  });

  it.each(['', 'Warsaw', 'Europe/Nie_Istnieje', '+01:00', 'CET', 'Europe/Warsaw; DROP', '../etc/passwd', 'a'.repeat(65), 'Europe//Warsaw', 'Europe/Warsaw/x/y/z', null, undefined, 42, {}])(
    'odrzuca %p',
    (input) => {
      expect(canonicalTimeZone(input)).toBeNull();
    },
  );
});
