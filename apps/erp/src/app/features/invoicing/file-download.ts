/** Hands a blob to the browser as a file the user saves. */
export function saveBlob(blob: Blob, filename: string): void {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** The printed number of an invoice for a file name (`000012`). */
export function invoiceFileName(number: number | null, extension: 'pdf' | 'xml'): string {
  return `factura-${String(number ?? 0).padStart(6, '0')}.${extension}`;
}
