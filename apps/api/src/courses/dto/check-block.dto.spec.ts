import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CheckBlockDto } from './check-block.dto';

async function fieldsWithErrors(body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(CheckBlockDto, body), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((error) => error.property);
}

describe('CheckBlockDto', () => {
  it('przyjmuje wybór (`option`), zbiór wielokrotnego wyboru (`options`, D-158) i werdykt karty', async () => {
    expect(await fieldsWithErrors({ option: 2 })).toEqual([]);
    expect(await fieldsWithErrors({ options: [0, 2, 7] })).toEqual([]);
    expect(await fieldsWithErrors({ card: 'op-karta_1', verdict: 'ok' })).toEqual([]);
  });

  it('odrzuca zbiór pusty, za długi, z liczbą spoza 0-7, ułamkiem albo tekstem', async () => {
    for (const options of [[], [0, 1, 2, 3, 4, 5, 6, 7, 0], [8], [-1], [1.5], ['1'], 'abc', 3]) {
      expect(await fieldsWithErrors({ options })).toEqual(['options']);
    }
  });
});
