import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

/**
 * Prepares an XML (or a .tar of XMLs for contingency/bulk) for the reception service:
 * gzip it, compute the SHA-256 of the compressed bytes (hex) and encode it as base64.
 */
export function packageFile(content: Buffer | string): { file: string; fileHash: string; bytes: number } {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  const gz = gzipSync(buffer);
  return {
    file: gz.toString('base64'),
    fileHash: createHash('sha256').update(gz).digest('hex'),
    bytes: gz.length,
  };
}
