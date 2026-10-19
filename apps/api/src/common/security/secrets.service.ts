import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Env } from '../../config/env';

/**
 * Cifrado AES-256-GCM para secretos guardados en BD (token SIAT, .p12 de firma y su contraseña).
 * Formato: v1.<iv>.<tag>.<datos> en base64url. La clave vive solo en SECRETS_KEY.
 */
@Injectable()
export class SecretsService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private key(): Buffer {
    const raw = this.config.get('SECRETS_KEY', { infer: true });
    if (!raw) throw new InternalServerErrorException('SECRETS_KEY no está configurada');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new InternalServerErrorException('SECRETS_KEY debe ser de 32 bytes (base64)');
    return key;
  }

  encrypt(plain: string | Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv, tag, data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  decrypt(payload: string): Buffer {
    const [v, iv, tag, data] = payload.split('.');
    if (v !== 'v1') throw new InternalServerErrorException('Formato de secreto desconocido');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
  }
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
