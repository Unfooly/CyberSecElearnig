import { BadRequestException, Injectable, Optional, PipeTransform } from '@nestjs/common';

// Identyfikatory (cuid i klucze seedów): litery, cyfry, _ i -, do 64 znaków. Odrzuca śmieci zanim trafią do zapytania.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

@Injectable()
export class SafeIdPipe implements PipeTransform<string | undefined, string | undefined> {
  // optional: brak wartości (np. opcjonalny parametr query) jest dozwolony; wartość podana musi być poprawna.
  // @Optional(): gdy Nest tworzy pipe z samej klasy (@Param('id', SafeIdPipe)), opcje nie są wstrzykiwane.
  constructor(@Optional() private readonly options: { optional?: boolean } = {}) {}

  transform(value: string | undefined): string | undefined {
    if (value === undefined && this.options.optional) {
      return undefined;
    }
    if (typeof value !== 'string' || !SAFE_ID.test(value)) {
      throw new BadRequestException('Nieprawidłowy identyfikator.');
    }
    return value;
  }
}
