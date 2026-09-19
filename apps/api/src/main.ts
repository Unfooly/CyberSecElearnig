import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
