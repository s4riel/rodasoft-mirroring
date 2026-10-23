import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageDriver } from './storage.driver';
import { StorageService } from './storage.service';

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

  it('saves a file and reads it back by its key', async () => {
    const service = local();
    const key = await service.save(companyId, 'photo', jpeg, 'jpeg');
    expect(key).toMatch(new RegExp(`^${companyId}/photo/[0-9a-f-]{36}[.]jpg$`));
    expect(await service.read(key)).toEqual(jpeg);
  });

  it('answers null for a key that does not exist', async () => {
    expect(await local().read(`${companyId}/photo/0190e8a0-0000-7000-8000-0000000000ff.jpg`)).toBeNull();
  });

  it('refuses a key that climbs out of the storage root', async () => {
    await expect(new LocalStorageDriver(root).get('../outside.txt')).rejects.toThrow('outside the storage root');
  });

  it('needs a bucket and credentials to use the S3 driver', async () => {
    const service = new StorageService(
      new ConfigService({ STORAGE_DRIVER: 's3', STORAGE_S3_BUCKET: '', STORAGE_S3_ACCESS_KEY: '', STORAGE_S3_SECRET_KEY: '' }) as never,
    );
    await expect(service.save(companyId, 'photo', jpeg, 'jpeg')).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
