import { HttpException } from '@nestjs/common';
import { SETTINGS_PATH, seatLimitError, seatUsageOf } from './seats';

describe('seatUsageOf', () => {
  it('liczy wolne miejsca; nigdy nie zwraca wartości ujemnej (użytkowników więcej niż limit)', () => {
    expect(seatUsageOf(10, 3)).toEqual({ limit: 10, used: 3, available: 7 });
    expect(seatUsageOf(10, 10).available).toBe(0);
    expect(seatUsageOf(10, 14)).toEqual({ limit: 10, used: 14, available: 0 });
  });
});

describe('seatLimitError', () => {
  const body = (error: HttpException) => error.getResponse() as Record<string, unknown>;

  it('pojedyncze zaproszenie: 409, komunikat mówi ile zostało i odsyła do ustawień (zmiana planu)', () => {
    const error = seatLimitError(seatUsageOf(10, 10), 1);

    expect(error.getStatus()).toBe(409);
    expect(body(error)).toMatchObject({ code: 'SEAT_LIMIT', seatsLimit: 10, seatsUsed: 10, seatsAvailable: 0, seatsRequired: 1, seatsMissing: 1, settingsPath: SETTINGS_PATH });
    expect(body(error).message).toBe(`Brak wolnych licencji. Wykorzystano 10 z 10 licencji, zostało miejsc: 0. Aby dodać więcej osób, zmień plan w ustawieniach organizacji (${SETTINGS_PATH}).`);
  });

  it('import: komunikat podaje ile potrzeba, ile jest i ile BRAKUJE', () => {
    const error = seatLimitError(seatUsageOf(10, 7), 5);

    expect(body(error)).toMatchObject({ seatsAvailable: 3, seatsRequired: 5, seatsMissing: 2 });
    expect(body(error).message).toContain('potrzeba 5 miejsc');
    expect(body(error).message).toContain('zostało miejsc: 3');
    expect(body(error).message).toContain('Brakuje 2');
    expect(body(error).message).toContain(SETTINGS_PATH);
  });

  it('brak miejsc = brakuje tyle, ile potrzeba', () => {
    expect(body(seatLimitError(seatUsageOf(5, 8), 3))).toMatchObject({ seatsAvailable: 0, seatsMissing: 3 });
  });
});
