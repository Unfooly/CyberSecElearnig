/**
 * Wzajemne wykluczanie PER KLUCZ w obrębie jednego procesu (kolejka obietnic, FIFO).
 *
 * Po co: sekcje krytyczne chronione blokadą doradczą Postgresa (pg_advisory_xact_lock) muszą trzymać ją wewnątrz
 * transakcji, czyli zajmować połączenie z puli NA CZAS OCZEKIWANIA na blokadę. Przy N równoległych żądaniach N transakcji
 * czeka na blokadę, wyczerpuje pulę (domyślnie 2 x rdzenie + 1), a reszta aplikacji nie dostaje połączenia w `maxWait`
 * (Prisma P2028 "Unable to start a transaction in the given time" => 500) ani nie mieści się w `timeout` transakcji.
 * Ten mutex ustawia oczekujące w kolejce w JS (bez połączenia z bazą): do bazy idzie po jednym żądaniu na klucz.
 *
 * To NIE zastępuje blokady w bazie: chroni przed wyścigiem między instancjami API tylko blokada doradcza; mutex
 * jedynie ogranicza jej rywalizację w obrębie jednej instancji.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  /** Wykonuje `task` po zakończeniu poprzednich zadań o tym samym kluczu; błąd zadania nie blokuje kolejki. */
  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(task);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await result;
    } finally {
      // Sprzątanie: gdy nikt nie dołączył za nami, klucz znika (mapa nie rośnie z liczbą organizacji).
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }

  /** Liczba kluczy z zadaniami w toku (diagnostyka i testy). */
  get activeKeys(): number {
    return this.tails.size;
  }
}
