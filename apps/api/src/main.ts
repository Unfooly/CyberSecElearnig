import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureBodyParsing } from './common/body-parsing';
import { isProxyTrusted } from './common/client-ip';
import { configureSecurityHeaders } from './common/security-headers';

async function bootstrap() {
  // bodyParser: false - własne parsowanie ciała z middleware błędów (patrz common/body-parsing.ts): błędy parsera nie
  // mogą zwracać ani logować fragmentu ciała publicznych żądań.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // Nagłówki bezpieczeństwa jako pierwszy middleware (także odpowiedzi błędów parsera ciała); patrz common/security-headers.ts.
  configureSecurityHeaders(app);
  configureBodyParsing(app);

  // Za zaufanym proxy (produkcja: Cloudflare Tunnel -> web/BFF -> api) Express ma
  // ufać jednemu hopowi (req.ip z X-Forwarded-For). Bez proxy (lokalnie) nagłówki
  // są ignorowane, inaczej każdy mógłby podszyć IP. Limity żądań korzystają z
  // resolveClientIp (CF-Connecting-IP) - patrz common/client-ip.ts.
  app.set('trust proxy', isProxyTrusted() ? 1 : false);
  if (process.env.NODE_ENV === 'production' && !isProxyTrusted()) {
    // Bez TRUST_PROXY wszyscy odwiedzający (w tym publiczne /t/*) dzielą jeden licznik limitów (adres kontenera web).
    new Logger('Bootstrap').warn('NODE_ENV=production bez TRUST_PROXY=true: limity żądań liczą jeden wspólny adres dla wszystkich klientów.');
  }

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
