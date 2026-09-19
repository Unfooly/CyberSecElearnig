import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { resolveClientIp } from '../client-ip';

/**
 * ThrottlerGuard liczący limity po prawdziwym adresie klienta (patrz
 * resolveClientIp), a nie po adresie proxy/kontenera web, który dla api jest
 * jedynym rozmówcą. Bez tego limity na /auth/* i /demo-requests byłyby wspólne
 * dla wszystkich użytkowników.
 */
@Injectable()
export class ProxyAwareThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return resolveClientIp(req as Parameters<typeof resolveClientIp>[0]);
  }
}
