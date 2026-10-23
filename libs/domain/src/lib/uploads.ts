/** Rules of the product uploads (HU-INV-06): photos and datasheets, checked by their content, not their declared type. */

export type UploadKind = 'photo' | 'datasheet';

export type UploadType = 'jpeg' | 'png' | 'webp' | 'pdf';

export const UPLOAD_LIMITS: Readonly<Record<UploadKind, { maxBytes: number; types: readonly UploadType[] }>> = {
  photo: { maxBytes: 5 * 1024 * 1024, types: ['jpeg', 'png', 'webp'] },
  datasheet: { maxBytes: 10 * 1024 * 1024, types: ['pdf'] },
};

export const UPLOAD_CONTENT_TYPE: Readonly<Record<UploadType, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

export const UPLOAD_EXTENSION: Readonly<Record<UploadType, string>> = { jpeg: 'jpg', png: 'png', webp: 'webp', pdf: 'pdf' };

/** The file type from its leading bytes (magic numbers); null when it matches none of the accepted types. */
export function detectUploadType(bytes: Uint8Array): UploadType | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  return null;
}

export type UploadRejection = 'FILE_TOO_LARGE' | 'UNSUPPORTED_FILE_TYPE';

/** The error code for an upload that may not be stored, or the accepted type when it may. */
export function checkUpload(kind: UploadKind, bytes: Uint8Array): { type: UploadType } | { rejection: UploadRejection } {
  const limits = UPLOAD_LIMITS[kind];
  if (bytes.byteLength > limits.maxBytes) return { rejection: 'FILE_TOO_LARGE' };
  const type = detectUploadType(bytes);
  if (!type || !limits.types.includes(type)) return { rejection: 'UNSUPPORTED_FILE_TYPE' };
  return { type };
}
