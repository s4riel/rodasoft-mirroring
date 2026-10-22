import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Env } from '../../config/env';

/**
 * AES-256-GCM encryption for secrets stored in the DB (SIAT token, signing .p12 and its password).
 * Format: v1.<iv>.<tag>.<data> in base64url. The key lives only in SECRETS_KEY.
 */
@Injectable()
export class SecretsService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private key(): Buffer {
    const raw = this.config.get('SECRETS_KEY', { infer: true });
    if (!raw) throw new InternalServerErrorException('SECRETS_KEY is not configured');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new InternalServerErrorException('SECRETS_KEY must be 32 bytes (base64)');
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
    if (v !== 'v1') throw new InternalServerErrorException('Unknown secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
  }
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
