import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** Where uploaded files live. The service picks one by configuration; both keep the same key layout. */
export interface StorageDriver {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** The stored bytes, or null when the key does not exist. */
  get(key: string): Promise<Buffer | null>;
}

/** Development and tests: files in a folder on disk. */
export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathOf(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Keys are `<company>/<kind>/<uuid>.<ext>`; one that climbs out of the root is refused. */
  private pathOf(key: string): string {
    const path = join(this.root, key);
    if (!path.startsWith(this.root)) throw new Error('Storage key outside the storage root');
    return path;
  }
}

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** For S3-compatible services (MinIO, R2, Spaces); empty for AWS. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** Production: an S3-compatible bucket. */
export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;

  constructor(private readonly options: S3StorageOptions) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint || undefined,
      forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
      const bytes = await out.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }
}
