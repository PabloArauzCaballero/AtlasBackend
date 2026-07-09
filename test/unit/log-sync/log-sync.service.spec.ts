import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { countLines, readLogDelta } from '../../../src/modules/log-sync/log-sync.service.js';

describe('readLogDelta', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'atlas-log-sync-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns only content after the last offset', async () => {
    const filePath = join(dir, 'Archivo.log');
    await writeFile(filePath, 'old\nnew\n', 'utf8');

    const delta = await readLogDelta(filePath, Buffer.byteLength('old\n', 'utf8'), 1_000);

    expect(delta).toMatchObject({
      exists: true,
      rotated: false,
      offsetFrom: 4,
      offsetTo: 8,
      content: 'new\n',
    });
  });

  it('reports missing files without advancing the offset', async () => {
    const delta = await readLogDelta(join(dir, 'Archivo.log'), 42, 1_000);

    expect(delta).toMatchObject({
      exists: false,
      rotated: false,
      previousOffset: 42,
      offsetFrom: 42,
      offsetTo: 42,
      content: '',
      fileSize: 0,
    });
  });

  it('detects truncation and restarts from zero', async () => {
    const filePath = join(dir, 'Archivo.log');
    await writeFile(filePath, 'fresh\n', 'utf8');

    const delta = await readLogDelta(filePath, 100, 1_000);

    expect(delta).toMatchObject({
      exists: true,
      rotated: true,
      previousOffset: 100,
      offsetFrom: 0,
      offsetTo: 6,
      content: 'fresh\n',
    });
  });

  it('caps one append chunk by max bytes', async () => {
    const filePath = join(dir, 'Archivo.log');
    await writeFile(filePath, 'abcdef', 'utf8');

    const delta = await readLogDelta(filePath, 0, 3);

    expect(delta).toMatchObject({
      offsetFrom: 0,
      offsetTo: 3,
      content: 'abc',
      fileSize: 6,
    });
  });
});

describe('countLines', () => {
  it('counts newline-delimited content', () => {
    expect(countLines('one\n')).toBe(1);
    expect(countLines('one\ntwo')).toBe(2);
    expect(countLines('one\ntwo\n')).toBe(2);
    expect(countLines('single line')).toBe(1);
    expect(countLines('')).toBe(0);
  });
});
