import { BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from '../../common/storage/storage.service';
import { UploadsController } from './uploads.controller';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const pdf = Buffer.from('%PDF-1.7\n%test\n');
const companyId = '0190e8a0-0000-7000-8000-000000000001';

describe('UploadsController', () => {
  let root: string;
  let controller: UploadsController;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'rodasoft-uploads-'));
    const storage = new StorageService(new ConfigService({ STORAGE_LOCAL_DIR: root }) as never);
    controller = new UploadsController(storage, { get: () => companyId } as never);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const file = (buffer: Buffer) => ({ buffer, size: buffer.length });

  it('stores a photo under the company folder and returns its key', async () => {
    const result = await controller.upload(file(jpeg), { kind: 'photo' });

    expect(result).toEqual({ key: expect.stringMatching(new RegExp(`^${companyId}/photo/.+[.]jpg$`)), kind: 'photo', contentType: 'image/jpeg', size: jpeg.length });
    expect(await readFile(join(root, result.key))).toEqual(jpeg);
  });

  it('stores a datasheet as a PDF', async () => {
    const result = await controller.upload(file(pdf), { kind: 'datasheet' });
    expect(result.key).toMatch(/\/datasheet\/.+\.pdf$/);
    expect(result.contentType).toBe('application/pdf');
  });

  it('refuses a missing file with 400 FILE_REQUIRED', async () => {
    await expect(controller.upload(undefined, { kind: 'photo' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a PDF sent as a photo with 415', async () => {
    await expect(controller.upload(file(pdf), { kind: 'photo' })).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('refuses a photo over its limit with 413', async () => {
    const big = Buffer.concat([jpeg, Buffer.alloc(5 * 1024 * 1024)]);
    await expect(controller.upload(file(big), { kind: 'photo' })).rejects.toBeInstanceOf(PayloadTooLargeException);
  });
});
