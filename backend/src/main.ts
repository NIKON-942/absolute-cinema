import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrapTracing(): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;
  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import(
      '@opentelemetry/exporter-trace-otlp-http'
    );
    const { Resource } = await import('@opentelemetry/resources');
    const {
      SemanticResourceAttributes,
    } = await import('@opentelemetry/semantic-conventions');
    const {
      getNodeAutoInstrumentations,
    } = await import('@opentelemetry/auto-instrumentations-node');

    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'absolutecinema-api',
      }),
      traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    await sdk.start();
  } catch {
    // tracing is observability sugar — never block API boot on it
  }
}

async function bootstrap(): Promise<void> {
  await bootstrapTracing();

  // Refuse to run a production deployment on the well-known dev secret —
  // anyone could forge admin tokens offline.
  if (
    process.env.NODE_ENV === 'production' &&
    (process.env.JWT_SECRET ?? 'dev-only-secret-change-me') ===
      'dev-only-secret-change-me'
  ) {
    throw new Error(
      'Refusing to start: JWT_SECRET is not set (default dev secret in production)',
    );
  }

  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api');

  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AbsoluteCinema API')
      .setDescription('VoD platform REST API — see docs/api-contract.md for the authoritative contract')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  app.enableCors({
    origin: process.env.CLIENT_URL?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const port = parseInt(process.env.PORT ?? '4000', 10);
  await app.listen(port);
  console.log(`AbsoluteCinema API listening on http://localhost:${port}/api`);
}

bootstrap();
