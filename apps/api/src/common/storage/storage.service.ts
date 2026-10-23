import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { UPLOAD_CONTENT_TYPE, UPLOAD_EXTENSION, type UploadKind, type UploadType } from '@rodasoft/domain';
import type { Env } from '../../config/env';
import { LocalStorageDriver, S3StorageDriver, type StorageDriver } from './storage.driver';

/**
 * Stores and reads the uploaded files of a company (HU-INV-06): a local folder in development, an S3-compatible bucket in
 * production (`STORAGE_DRIVER`). Keys are `<company>/<kind>/<uuid>.<ext>`. Callers validate the content first
 * (`checkUpload`), so the bytes stored here are already known to be allowed.
 */
@Injectable()
export class StorageService {
  private driver?: StorageDriver;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async save(companyId: string, kind: UploadKind, bytes: Buffer, type: UploadType): Promise<string> {
    const key = `${companyId}/${kind}/${randomUUID()}.${UPLOAD_EXTENSION[type]}`;
    await this.storage().put(key, bytes, UPLOAD_CONTENT_TYPE[type]);
    return key;
  }

  async read(key: string): Promise<Buffer | null> {
    return this.storage().get(key);
  }

  private storage(): StorageDriver {
    this.driver ??= this.config.get('STORAGE_DRIVER', { infer: true }) === 's3' ? this.s3() : new LocalStorageDriver(this.config.get('STORAGE_LOCAL_DIR', { infer: true }));
    return this.driver;
  }

  private s3(): StorageDriver {
    const get = <K extends keyof Env>(key: K) => this.config.get(key, { infer: true });
    const bucket = get('STORAGE_S3_BUCKET');
    const accessKeyId = get('STORAGE_S3_ACCESS_KEY');
    const secretAccessKey = get('STORAGE_S3_SECRET_KEY');
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new InternalServerErrorException({ code: 'STORAGE_NOT_CONFIGURED', message: 'The S3 storage needs a bucket and credentials' });
    }
    return new S3StorageDriver({
      bucket,
      region: get('STORAGE_S3_REGION'),
      endpoint: get('STORAGE_S3_ENDPOINT'),
      accessKeyId,
      secretAccessKey,
      forcePathStyle: get('STORAGE_S3_FORCE_PATH_STYLE'),
    });
  }
}
