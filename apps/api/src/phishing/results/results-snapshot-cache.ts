import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { Group } from './results-aggregation';

/** Domyślny czas życia migawki agregatów: godzina (decyzja właściciela produktu 2026-09-20). */
export const DEFAULT_RESULTS_CACHE_TTL_SECONDS = 3600;
const LOCAL_MAX_ENTRIES = 500;

export interface ResultsSnapshot {
  /** Chwila policzenia migawki (ms od epoki) - pokazywana w UI jako "dane z godz.". */
  computedAt: number;
  /** Statystyki per dział: WYŁĄCZNIE liczby (dostarczono, kliknęło, ...) i nazwa działu; żadnych danych o osobach. */
  groups: Group[];
}

/**
 * Migawka agregatów wyników symulacji odświeżana NIE częściej niż raz na godzinę (TTL stały od chwili policzenia, nie
 * przesuwany odczytami). Cel: wzrost licznika w grupie >= 3 osób ("zgłosiło" +1 zaraz po tym, jak ktoś powiedział, że zgłosił)
 * nie może być obserwowalny w czasie rzeczywistym - to jedno tanie ograniczenie kanału różnicowania w czasie
 * (docs/phishing-simulations.md). Dotyczy WYŁĄCZNIE agregatów (widok per dział, CSV agregatów, KPI); widok osobowy jest
 * audytowany i czytany bez opóźnienia.
 *
 * Bezpieczeństwo: klucz zawiera organizationId z JWT (izolacja tenantów), a wartość to same liczby per dział. Cache jest
 * odczytywany DOPIERO po sprawdzeniu roli, statusu i istnienia kampanii w bazie - nie zastępuje autoryzacji.
 * Redis (wspólny dla instancji API), z rezerwą w pamięci procesu, gdy jest niedostępny; równoległe żądania o ten sam klucz
 * dzielą jedno przeliczenie.
 *
 * RESULTS_CACHE_TTL_SECONDS: domyślnie 3600; 0 = wyłączony (domyślnie w NODE_ENV=test, jak BACKGROUND_JOBS_ENABLED).
 */
const STAT_KEYS = ['delivered', 'clicked', 'submitted', 'reported', 'reportedAfterClick'] as const;

/** Kształt grupy z Redisa: wartość uszkodzona albo podsunięta (np. po kompromitacji Redisa) jest odrzucana, a migawka przeliczana. */
function isValidGroup(group: unknown): group is Group {
  const value = group as Group | null;
  if (!value || typeof value !== 'object' || typeof value.key !== 'string' || typeof value.name !== 'string') return false;
  if (value.departmentId !== null && typeof value.departmentId !== 'string') return false;
  return !!value.stats && STAT_KEYS.every((key) => Number.isInteger(value.stats[key]) && value.stats[key] >= 0);
}

/**
 * Czas życia migawki i opóźnienia obserwacji zmian (ms) z RESULTS_CACHE_TTL_SECONDS: domyślnie godzina, 0 = wyłączone
 * (domyślnie w NODE_ENV=test). Wartość nieprawidłowa = bezpieczna domyślna (opóźnienie zostaje), nie wyłączenie ochrony.
 * Używane też przez widok zgłoszeń kierownika działu (to samo opóźnienie), więc jedno miejsce konfiguracji.
 */
export function resolveResultsCacheTtlMs(config: ConfigService): number {
  const raw = config.get<string>('RESULTS_CACHE_TTL_SECONDS')?.trim();
  let seconds: number;
  if (!raw) {
    seconds = config.get<string>('NODE_ENV') === 'test' ? 0 : DEFAULT_RESULTS_CACHE_TTL_SECONDS;
  } else {
    const parsed = Number(raw);
    seconds = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RESULTS_CACHE_TTL_SECONDS;
  }
  return Math.floor(seconds) * 1000;
}

@Injectable()
export class ResultsSnapshotCache {
  readonly ttlMs: number;
  private readonly local = new Map<string, ResultsSnapshot>();
  private readonly inflight = new Map<string, Promise<ResultsSnapshot>>();

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.ttlMs = resolveResultsCacheTtlMs(config);
  }

  /** Migawka z klucza, jeśli świeża (młodsza niż TTL względem `now`); w przeciwnym razie przeliczona i zapisana. */
  async get(key: string, compute: () => Promise<Group[]>, now: Date = new Date()): Promise<ResultsSnapshot> {
    if (this.ttlMs <= 0) {
      return { computedAt: now.getTime(), groups: await compute() };
    }
    const cached = await this.read(key);
    if (cached && this.isFresh(cached, now)) {
      return cached;
    }
    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }
    const created = (async () => {
      const snapshot: ResultsSnapshot = { computedAt: now.getTime(), groups: await compute() };
      await this.write(key, snapshot);
      return snapshot;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, created);
    return created;
  }

  private isFresh(snapshot: ResultsSnapshot, now: Date): boolean {
    const age = now.getTime() - snapshot.computedAt;
    return age >= 0 && age < this.ttlMs;
  }

  private redisKey(key: string): string {
    return this.redis.key('results-snapshot', key);
  }

  private async read(key: string): Promise<ResultsSnapshot | null> {
    if (this.redis.client && this.redis.isAvailable()) {
      try {
        const raw = await this.redis.client.get(this.redisKey(key));
        this.redis.reportSuccess();
        return raw ? this.parse(raw) : null;
      } catch (error) {
        this.redis.reportFailure(error as Error);
      }
    }
    return this.local.get(key) ?? null;
  }

  private async write(key: string, snapshot: ResultsSnapshot): Promise<void> {
    this.local.set(key, snapshot);
    if (this.local.size > LOCAL_MAX_ENTRIES) {
      const oldest = this.local.keys().next().value as string;
      this.local.delete(oldest);
    }
    if (this.redis.client && this.redis.isAvailable()) {
      try {
        // EX z zapasem: świeżość rozstrzyga computedAt, EX tylko sprząta klucze.
        await this.redis.client.set(this.redisKey(key), JSON.stringify(snapshot), 'EX', Math.ceil(this.ttlMs / 1000) + 60);
        this.redis.reportSuccess();
      } catch (error) {
        this.redis.reportFailure(error as Error);
      }
    }
  }

  private parse(raw: string): ResultsSnapshot | null {
    try {
      const value = JSON.parse(raw) as ResultsSnapshot;
      return typeof value?.computedAt === 'number' && Array.isArray(value.groups) && value.groups.every(isValidGroup) ? value : null;
    } catch {
      return null;
    }
  }
}
