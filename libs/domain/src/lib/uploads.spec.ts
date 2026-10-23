import { checkUpload, detectUploadType, UPLOAD_LIMITS } from './uploads';

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const webp = Uint8Array.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')]);
const pdf = Uint8Array.from(Buffer.from('%PDF-1.7\n'));

describe('detectUploadType', () => {
  it('reads the type from the leading bytes', () => {
    expect(detectUploadType(jpeg)).toBe('jpeg');
    expect(detectUploadType(png)).toBe('png');
    expect(detectUploadType(webp)).toBe('webp');
    expect(detectUploadType(pdf)).toBe('pdf');
  });

  it('does not trust a renamed file', () => {
    expect(detectUploadType(Uint8Array.from(Buffer.from('MZ\x90\x00')))).toBeNull();
  });
});

describe('checkUpload', () => {
  it('accepts an image as a photo and a PDF as a datasheet', () => {
    expect(checkUpload('photo', jpeg)).toEqual({ type: 'jpeg' });
    expect(checkUpload('datasheet', pdf)).toEqual({ type: 'pdf' });
  });

  it('refuses a PDF as a photo and an image as a datasheet (415)', () => {
    expect(checkUpload('photo', pdf)).toEqual({ rejection: 'UNSUPPORTED_FILE_TYPE' });
    expect(checkUpload('datasheet', jpeg)).toEqual({ rejection: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('refuses a file over the limit of its kind (413)', () => {
    const big = new Uint8Array(UPLOAD_LIMITS.photo.maxBytes + 1);
    big.set(jpeg);
    expect(checkUpload('photo', big)).toEqual({ rejection: 'FILE_TOO_LARGE' });
    // a datasheet may be larger than a photo
    const medium = new Uint8Array(UPLOAD_LIMITS.photo.maxBytes + 1);
    medium.set(pdf);
    expect(checkUpload('datasheet', medium)).toEqual({ type: 'pdf' });
  });
});
