import { Injectable } from '@nestjs/common';
import { Resolver } from 'dns/promises';

const DNS_TIMEOUT_MS = 3000;
// Twardy limit całego zapytania (na wypadek, gdyby resolver nie honorował timeoutu).
const HARD_LIMIT_MS = 5000;

/**
 * Abstrakcja nad zapytaniem DNS TXT - w testach podmieniana (nigdy prawdziwy
 * DNS), a jedyny konsument to DomainVerificationService. Rzuca przy błędzie
 * (NXDOMAIN, brak rekordu, timeout) - wywołujący traktuje każdy wyjątek jak
 * "nie znaleziono rekordu".
 */
export abstract class DnsTxtResolver {
  /** Zwraca rekordy TXT jako tablice fragmentów (DNS dzieli długie TXT na kawałki po 255 B). */
  abstract resolveTxt(host: string): Promise<string[][]>;
}

@Injectable()
export class NodeDnsTxtResolver extends DnsTxtResolver {
  // Jeden resolver z krótkim timeoutem i jedną próbą: przycisk "Sprawdź teraz"
  // nie może wisieć na wolnym serwerze DNS cudzej domeny.
  private readonly resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });

  async resolveTxt(host: string): Promise<string[][]> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('DNS timeout')), HARD_LIMIT_MS);
    });
    try {
      return await Promise.race([this.resolver.resolveTxt(host), limit]);
    } finally {
      clearTimeout(timer);
    }
  }
}
