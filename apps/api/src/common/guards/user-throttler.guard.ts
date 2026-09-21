import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { resolveClientIp } from '../client-ip';

/**
 * Limit żądań liczony PER ZALOGOWANY UŻYTKOWNIK (nie per adres IP). Używać po JwtAuthGuard (`@UseGuards(JwtAuthGuard,
 * UserThrottlerGuard)`), który ustawia req.user. Globalny ProxyAwareThrottlerGuard nadal liczy limit per IP osobno (inny
 * tracker = inny licznik), więc te dwa limity się sumują, nie zastępują.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId: unknown = req.user?.userId;
    return typeof userId === 'string' && userId ? `user:${userId}` : resolveClientIp(req as Parameters<typeof resolveClientIp>[0]);
  }
}
