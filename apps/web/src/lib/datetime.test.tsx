import { describe, it, expect, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import CampaignsList from '@/app/dashboard/phishing/campaigns/_components/CampaignsList';
import type { Campaign } from '@/lib/phishing-types';
import { DEFAULT_TIMEZONE, formatDateLong, formatDateTime, formatMonthLabel, formatYear, isoToZonedInput, zonedInputToIso } from './datetime';

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

// Strefy procesu, w których "serwer" i "przeglądarka" mogą działać: format NIE może od nich zależeć.
const PROCESS_ZONES = ['UTC', 'Europe/Warsaw', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati'];

describe('formatDateTime: jawna strefa, niezależna od strefy procesu (SSR vs przeglądarka)', () => {
  it('ta sama chwila daje identyczny tekst niezależnie od TZ procesu; lato CEST (+2) i zima CET (+1)', () => {
    for (const zone of PROCESS_ZONES) {
      process.env.TZ = zone;
      expect(formatDateTime('2026-09-20T08:33:00.000Z')).toBe('20 wrz 2026, 10:33');
      expect(formatDateTime('2027-01-15T08:33:00.000Z')).toBe('15 sty 2027, 09:33');
    }
  });

  it('błąd z zgłoszenia: okno kampanii 08:33-08:43 UTC to 10:33-10:43 w Europe/Warsaw - w KAŻDEJ strefie procesu', () => {
    for (const zone of PROCESS_ZONES) {
      process.env.TZ = zone;
      expect([formatDateTime('2026-09-20T08:33:00.000Z'), formatDateTime('2026-09-20T08:43:00.000Z')]).toEqual(['20 wrz 2026, 10:33', '20 wrz 2026, 10:43']);
    }
  });

  it('jawnie podana strefa działa; przełom doby: 23:30 UTC to już następny dzień w Warszawie', () => {
    expect(formatDateTime('2026-09-20T08:33:00.000Z', 'UTC')).toBe('20 wrz 2026, 08:33');
    expect(formatDateTime('2026-09-20T08:33:00.000Z', 'Asia/Tokyo')).toBe('20 wrz 2026, 17:33');
    expect(formatDateTime('2026-12-31T23:30:00.000Z')).toBe('1 sty 2027, 00:30');
    expect(formatDateLong('2026-12-31T23:30:00.000Z')).toBe('1 stycznia 2027');
    expect(formatYear('2026-12-31T23:30:00.000Z')).toBe('2027');
    expect(formatYear('2026-12-31T23:30:00.000Z', 'UTC')).toBe('2026');
  });

  it('brak wartości => tekst zastępczy; domyślna strefa to Europe/Warsaw', () => {
    expect(formatDateTime(null)).toBe('Brak aktywności');
    expect(formatDateTime(undefined, DEFAULT_TIMEZONE, '-')).toBe('-');
    expect(DEFAULT_TIMEZONE).toBe('Europe/Warsaw');
  });

  it('etykieta miesiąca jest w UTC niezależnie od TZ procesu (miesiąc liczy backend)', () => {
    for (const zone of PROCESS_ZONES) {
      process.env.TZ = zone;
      expect(formatMonthLabel('2026-09')).toBe('wrz 2026');
    }
  });
});

describe('SSR i klient dają IDENTYCZNY tekst dla tej samej daty', () => {
  const campaign: Campaign = {
    id: 'c1', name: 'Kampania', status: 'SCHEDULED', audienceType: 'ALL', templateName: 'Kurier', subject: 'Paczka', senderName: 'K', senderAddress: null,
    windowStart: '2026-09-20T08:33:00.000Z', windowEnd: '2026-09-20T08:43:00.000Z', createdAt: '2026-09-20T08:00:00.000Z', cancelledAt: null, completedAt: null,
    createdByEmail: 'a@b.pl', counts: { total: 1, pending: 1, sent: 0, failed: 0, uncertain: 0 }, failures: [],
  };
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  it('lista kampanii: renderToString (serwer w UTC) == render w DOM (przeglądarka w innej strefie)', () => {
    process.env.TZ = 'UTC';
    const ssr = text(renderToString(<CampaignsList campaigns={[campaign]} />));
    process.env.TZ = 'America/Los_Angeles';
    const client = text(render(<CampaignsList campaigns={[campaign]} />).container.innerHTML);

    expect(ssr).toBe(client);
    expect(ssr).toContain('20 wrz 2026, 10:33');
    expect(ssr).toContain('do 20 wrz 2026, 10:43');
  });
});

describe('pola datetime-local: czas ścienny w strefie organizacji', () => {
  it('rundka: moment -> pole -> moment jest stabilna w różnych strefach procesu', () => {
    for (const zone of PROCESS_ZONES) {
      process.env.TZ = zone;
      const input = isoToZonedInput('2026-09-20T08:33:00.000Z');
      expect(input).toBe('2026-09-20T10:33');
      expect(zonedInputToIso(input)).toBe('2026-09-20T08:33:00.000Z');
    }
  });

  it('zima (CET) i lato (CEST); inna strefa jawnie', () => {
    expect(zonedInputToIso('2027-01-15T09:33')).toBe('2027-01-15T08:33:00.000Z');
    expect(zonedInputToIso('2026-07-01T12:00')).toBe('2026-07-01T10:00:00.000Z');
    expect(zonedInputToIso('2026-09-20T17:33', 'Asia/Tokyo')).toBe('2026-09-20T08:33:00.000Z');
    expect(zonedInputToIso('2026-09-20T08:33', 'UTC')).toBe('2026-09-20T08:33:00.000Z');
  });

  it('zmiana czasu: dziura wiosenna (02:30 nie istnieje) przesuwa się do przodu, jesienna dwuznaczność daje jeden z dwóch momentów', () => {
    expect(zonedInputToIso('2027-03-28T02:30')).toBe('2027-03-28T01:30:00.000Z'); // 03:30 CEST
    const ambiguous = zonedInputToIso('2026-10-25T02:30') as string;
    expect(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']).toContain(ambiguous);
    expect(isoToZonedInput(ambiguous)).toBe('2026-10-25T02:30');
  });

  it('niepoprawny tekst => null', () => {
    for (const bad of ['', 'jutro', '2026-09-20', '2026-09-20 10:33', '2026-13-45T25:61', '2026-09-20T10:33:00']) {
      expect(zonedInputToIso(bad)).toBeNull();
    }
  });
});

describe('strażnik: daty formatujemy WYŁĄCZNIE przez lib/datetime.ts', () => {
  const SRC = join(__dirname, '..');
  const FORBIDDEN = /toLocale(Date|Time)?String\(|getTimezoneOffset\(|Intl\.DateTimeFormat|\.getFullYear\(|\.getHours\(|\.getMinutes\(|\.getMonth\(|\.getDate\(|\.getDay\(/;

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return entry === 'node_modules' || entry === '.next' ? [] : sources(full);
      return /\.(ts|tsx)$/.test(full) && !/\.test\.tsx?$/.test(full) ? [full] : [];
    });
  }

  it('żaden plik poza lib/datetime.ts nie używa formatowania dat zależnego od strefy procesu', () => {
    const offenders = sources(SRC)
      .filter((file) => relative(SRC, file).split(sep).join('/') !== 'lib/datetime.ts')
      .filter((file) => FORBIDDEN.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));

    expect(offenders).toEqual([]);
  });
});
