import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { UPLOAD_EXTENSION, type UploadKind, type UploadType } from '@rodasoft/domain';
import type { Env } from '../../config/env';

/**
 * Stores uploaded files under a per-company folder and returns their key (HU-INV-06). The local-disk driver is the
 * only one for now; the production driver (an S3-compatible bucket) replaces `write` and keeps this interface.
 * Callers validate the content first (`checkUpload`), so the bytes stored here are already known to be allowed.
 */
@Injectable()
export class StorageService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async save(companyId: string, kind: UploadKind, bytes: Buffer, type: UploadType): Promise<string> {
    const key = `${companyId}/${kind}/${randomUUID()}.${UPLOAD_EXTENSION[type]}`;
    const path = join(resolve(this.config.get('STORAGE_LOCAL_DIR', { infer: true })), key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return key;
  }
}
