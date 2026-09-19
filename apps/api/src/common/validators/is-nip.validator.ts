import { isValidNip } from '@cyberszkolo/shared';
import { registerDecorator, ValidationOptions } from 'class-validator';

// NIP z poprawną sumą kontrolną (10 cyfr, spacje/myślniki/prefiks PL tolerowane).
export function IsNip(validationOptions?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'isNip',
      target: target.constructor,
      propertyName,
      options: {
        message: 'NIP jest nieprawidłowy - sprawdź numer i cyfrę kontrolną.',
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidNip(value),
      },
    });
  };
}
