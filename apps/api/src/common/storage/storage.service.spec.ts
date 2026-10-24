import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageDriver } from './storage.driver';
import { fileNameOf, StorageService } from './storage.service';

const companyId = '0190e8a0-0000-7000-8000-000000000001';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

describe('StorageService', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'rodasoft-storage-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const local = () => new StorageService(new ConfigService({ STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: root }) as never);

  it('saves a file named after the product code and reads it back by its key', async () => {
    const service = local();
    const key = await service.save(companyId, 'photo', jpeg, 'jpeg', 'SAVE-1');
    expect(key).toBe(`${companyId}/photo/SAVE-1_v1.jpg`);
    expect(await service.read(key)).toEqual(jpeg);
  });

  it('numbers the variants of the same code without overwriting', async () => {
    const service = local();
    const other = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x11]);
    const first = await service.save(companyId, 'photo', jpeg, 'jpeg', 'VAR-1');
    const second = await service.save(companyId, 'photo', other, 'jpeg', 'VAR-1');
    expect([first, second]).toEqual([`${companyId}/photo/VAR-1_v1.jpg`, `${companyId}/photo/VAR-1_v2.jpg`]);
    expect(await service.read(first)).toEqual(jpeg);
    expect(await service.read(second)).toEqual(other);
  });

  it('turns a code with spaces or symbols into a safe file name', async () => {
    expect(fileNameOf(' RT 35/52 ')).toBe('RT-35-52');
    expect(fileNameOf('a_b')).toBe('a-b');
    expect(fileNameOf('///')).toBe('product');
  });

  it('answers null for a key that does not exist', async () => {
    expect(await local().read(`${companyId}/photo/NOPE_v1.jpg`)).toBeNull();
  });

  it('refuses a key that climbs out of the storage root', async () => {
    await expect(new LocalStorageDriver(root).get('../outside.txt')).rejects.toThrow('outside the storage root');
  });

  it('needs a cloud name and credentials to use the Cloudinary driver', async () => {
    const service = new StorageService(
      new ConfigService({ STORAGE_DRIVER: 'cloudinary', CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '' }) as never,
    );
    await expect(service.save(companyId, 'photo', jpeg, 'jpeg', 'RT-1')).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
