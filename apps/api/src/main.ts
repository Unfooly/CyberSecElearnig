import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { isProxyTrusted } from './common/client-ip';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Za zaufanym proxy (produkcja: Cloudflare Tunnel -> web/BFF -> api) Express ma
  // ufać jednemu hopowi (req.ip z X-Forwarded-For). Bez proxy (lokalnie) nagłówki
  // są ignorowane, inaczej każdy mógłby podszyć IP. Limity żądań korzystają z
  // resolveClientIp (CF-Connecting-IP) - patrz common/client-ip.ts.
  app.set('trust proxy', isProxyTrusted() ? 1 : false);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // SIGTERM/SIGINT (Docker, ECS) => onModuleDestroy: worker BullMQ dokańcza
  // trwające zadanie, Prisma zamyka połączenia.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}
bootstrap();
