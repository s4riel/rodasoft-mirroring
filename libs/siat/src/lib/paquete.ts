import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

/**
 * Prepara un XML (o un .tar de XMLs en contingencia/masiva) para el servicio de recepción:
 * comprimir con gzip, calcular SHA-256 del comprimido (hex) y codificar en base64.
 */
export function empaquetarArchivo(contenido: Buffer | string): { archivo: string; hashArchivo: string; bytes: number } {
  const buffer = typeof contenido === 'string' ? Buffer.from(contenido, 'utf8') : contenido;
  const gz = gzipSync(buffer);
  return {
    archivo: gz.toString('base64'),
    hashArchivo: createHash('sha256').update(gz).digest('hex'),
    bytes: gz.length,
  };
}
