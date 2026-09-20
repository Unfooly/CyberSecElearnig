import { registerDecorator, ValidationOptions } from 'class-validator';

// Nazwa IANA: "Region/Miasto" (do trzech członów) albo "UTC". Odrzuca offsety ("+01:00") i skróty ("CET"), które Intl
// akceptuje w różnych wersjach Node, a które nie niosą reguł czasu letniego.
const IANA_SHAPE = /^(UTC|[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){1,2})$/;

/** Kanoniczna nazwa strefy (wielkość liter wg IANA) albo null, gdy strefa nie istnieje. */
export function canonicalTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || !IANA_SHAPE.test(value)) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function IsIanaTimeZone(options?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'isIanaTimeZone',
      target: target.constructor,
      propertyName,
      options: { message: 'Nieprawidłowa strefa czasowa (podaj nazwę IANA, np. Europe/Warsaw).', ...options },
      validator: { validate: (value: unknown) => canonicalTimeZone(value) !== null },
    });
  };
}
