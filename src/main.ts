import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe, Logger } from '@nestjs/common';
import { config } from './config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);

  // enable CORS (adjust options as needed for production)
  app.enableCors();

  // enable graceful shutdown hooks so onModuleDestroy is called
  app.enableShutdownHooks();

  // global validation pipe (DTOs will be validated automatically)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties that do not have any decorators
      forbidNonWhitelisted: false, // set to true to reject requests with unknown props
      transform: true, // auto-transform payloads to DTO instances
    }),
  );

  // Swagger / OpenAPI setup
  const swaggerOptions = new DocumentBuilder()
    .setTitle('NestJS Crawler')
    .setDescription('Crawler API — start/monitor/cancel crawl jobs')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerOptions);
  SwaggerModule.setup('api', app, document);

  // start listening
  await app.listen(config.port);
  logger.log(`Server started on http://localhost:${config.port}`);
}

bootstrap().catch((err) => {
  // top-level catch so startup errors are visible
  // eslint-disable-next-line no-console
  console.error('Failed to bootstrap application', err);
  process.exit(1);
});
