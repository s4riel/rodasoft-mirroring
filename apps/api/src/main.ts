import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { writeFileSync } from 'node:fs';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap() {
  const exportIdx = process.argv.indexOf('--export-openapi');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  const config = app.get(ConfigService<Env, true>);

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('CORS_ORIGINS').split(',').map((o: string) => o.trim()),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  // detrás de Caddy: confiar en X-Forwarded-For / -Proto
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Rodasoft API')
      .setDescription('ERP Rodalaser: multiempresa, inventario, ventas, facturación SIAT, compras, CRM y contabilidad')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Empresa' }, 'empresa')
      .addSecurityRequirements('empresa')
      .build(),
  );

  if (exportIdx > -1) {
    const out = process.argv[exportIdx + 1] ?? 'dist/openapi.json';
    writeFileSync(out, JSON.stringify(doc, null, 2));
    Logger.log(`OpenAPI exportado a ${out}`, 'Bootstrap');
    await app.close();
    return;
  }

  if (config.get('NODE_ENV') !== 'production') SwaggerModule.setup('api/docs', app, doc);

  const port = config.get('API_PORT');
  await app.listen(port);
  Logger.log(`API lista en http://localhost:${port}/api/v1 · documentación en /api/docs`, 'Bootstrap');
}

bootstrap();
