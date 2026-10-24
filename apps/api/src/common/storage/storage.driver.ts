import { v2 as cloudinary } from 'cloudinary';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** Where uploaded files live. The service picks one by configuration; both keep the same key layout. */
export interface StorageDriver {
  /**
   * Stores the bytes and returns the reference the product keeps: the key on disk, the public URL on Cloudinary. A key that
   * is already taken is never overwritten: the answer is null so the caller can try the next variant.
   */
  put(key: string, bytes: Buffer, contentType: string): Promise<string | null>;
  /** The stored bytes, or null when the key does not exist. */
  get(key: string): Promise<Buffer | null>;
}

/** Development and tests: files in a folder on disk. */
export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, bytes: Buffer): Promise<string | null> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, bytes, { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return null;
      throw err;
    }
    return key;
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

export interface CloudinaryStorageOptions {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /** Root folder inside the Cloudinary account, so several environments can share one account. */
  folder: string;
}

/**
 * Production: Cloudinary. Files are public assets: the product stores the `secure_url` that Cloudinary returns and the
 * ERP and the store load it straight from the CDN. Images use their key without extension as public id; PDFs are `raw`
 * assets, whose public id keeps the extension.
 */
export class CloudinaryStorageDriver implements StorageDriver {
  constructor(private readonly options: CloudinaryStorageOptions) {
    cloudinary.config({ cloud_name: options.cloudName, api_key: options.apiKey, api_secret: options.apiSecret, secure: true });
  }

  async put(key: string, bytes: Buffer): Promise<string | null> {
    const { publicId, resourceType } = this.targetOf(key);
    return new Promise<string | null>((done, fail) => {
      const stream = cloudinary.uploader.upload_stream(
        // `asset_folder` is what the Media Library shows as the folder on accounts with dynamic folders (the default today);
        // the public id keeps the same path, so the URL is the same on accounts with fixed folders
        { public_id: publicId, asset_folder: publicId.slice(0, publicId.lastIndexOf('/')), resource_type: resourceType, type: 'upload', overwrite: false },
        // with `overwrite: false` Cloudinary answers the asset that already uses the id, flagged `existing`
        // Cloudinary rejects with a plain object ({ message, http_code }), not an Error: wrap it so the cause reaches the log
        (err, result) =>
          err || !result
            ? fail(new Error(`Cloudinary upload failed for ${key}: ${err?.message ?? 'no result'}${err?.http_code ? ` (HTTP ${err.http_code})` : ''}`))
            : done((result as { existing?: boolean }).existing ? null : result.secure_url),
      );
      stream.end(bytes);
    });
  }

  async get(key: string): Promise<Buffer | null> {
    const { publicId, resourceType, format } = this.targetOf(key);
    const url = cloudinary.url(publicId, { resource_type: resourceType, type: 'upload', secure: true, format });
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Cloudinary answered ${response.status} for ${key}`);
    return Buffer.from(await response.arrayBuffer());
  }

  private targetOf(key: string): { publicId: string; resourceType: 'image' | 'raw'; format?: string } {
    const extension = key.slice(key.lastIndexOf('.') + 1);
    const path = `${this.options.folder}/${key}`;
    if (extension === 'pdf') return { publicId: path, resourceType: 'raw' };
    return { publicId: path.slice(0, path.length - extension.length - 1), resourceType: 'image', format: extension };
  }
}
