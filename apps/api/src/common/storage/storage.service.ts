import { ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UPLOAD_CONTENT_TYPE, UPLOAD_EXTENSION, type UploadKind, type UploadType } from '@rodasoft/domain';
import type { Env } from '../../config/env';
import { CloudinaryStorageDriver, LocalStorageDriver, type StorageDriver } from './storage.driver';

/** Most variants (`_v1` … `_v50`) a product code can have per kind. */
const MAX_VARIANTS = 50;

/** The product code as a file name: letters, digits and dashes only (the `_` is kept for the variant suffix). */
export function fileNameOf(code: string): string {
  return code.trim().replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'product';
}

/**
 * Stores and reads the uploaded files of a company (HU-INV-06): a local folder in development, Cloudinary in
 * production (`STORAGE_DRIVER`). Keys are `<company>/<kind>/<code>_v<n>.<ext>`. Callers validate the content first
 * (`checkUpload`), so the bytes stored here are already known to be allowed.
 */
@Injectable()
export class StorageService {
  private driver?: StorageDriver;

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Saves under `<company>/<kind>/<code>_v<n>.<ext>`, with the first free variant number for the product code. */
  async save(companyId: string, kind: UploadKind, bytes: Buffer, type: UploadType, code: string): Promise<string> {
    const name = fileNameOf(code);
    for (let variant = 1; variant <= MAX_VARIANTS; variant++) {
      const key = `${companyId}/${kind}/${name}_v${variant}.${UPLOAD_EXTENSION[type]}`;
      const stored = await this.storage().put(key, bytes, UPLOAD_CONTENT_TYPE[type]);
      if (stored) return stored;
    }
    throw new ConflictException({ code: 'TOO_MANY_VARIANTS', message: 'This product code has too many files' });
  }

  async read(key: string): Promise<Buffer | null> {
    return this.storage().get(key);
  }

  private storage(): StorageDriver {
    this.driver ??= this.config.get('STORAGE_DRIVER', { infer: true }) === 'cloudinary' ? this.cloudinary() : new LocalStorageDriver(this.config.get('STORAGE_LOCAL_DIR', { infer: true }));
    return this.driver;
  }

  private cloudinary(): StorageDriver {
    const get = <K extends keyof Env>(key: K) => this.config.get(key, { infer: true });
    const cloudName = get('CLOUDINARY_CLOUD_NAME');
    const apiKey = get('CLOUDINARY_API_KEY');
    const apiSecret = get('CLOUDINARY_API_SECRET');
    if (!cloudName || !apiKey || !apiSecret) {
      throw new InternalServerErrorException({ code: 'STORAGE_NOT_CONFIGURED', message: 'The Cloudinary storage needs a cloud name and API credentials' });
    }
    return new CloudinaryStorageDriver({ cloudName, apiKey, apiSecret, folder: get('CLOUDINARY_FOLDER') });
  }
}
