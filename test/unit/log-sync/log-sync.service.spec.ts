import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { countLines, readLogDelta, trimLogFileToTail } from '../../../src/modules/log-sync/log-sync.reader.util.js';

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

describe('trimLogFileToTail', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'atlas-log-trim-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('leaves a file that is under the cap untouched', async () => {
    const filePath = join(dir, 'Archivo.log');
    await writeFile(filePath, 'una\ndos\n', 'utf8');

    const result = await trimLogFileToTail(filePath, 1_000);

    expect(result).toEqual({ trimmed: false, droppedBytes: 0, newSize: 8 });
    expect(await readFile(filePath, 'utf8')).toBe('una\ndos\n');
  });

  it('keeps the tail and drops the head when the file is over the cap', async () => {
    const filePath = join(dir, 'Archivo.log');
    await writeFile(filePath, 'aaaa\nbbbb\ncccc\ndddd\n', 'utf8');

    const result = await trimLogFileToTail(filePath, 12);

    // Lo conservado es el final, no el principio: cuando hay que tirar algo, lo ultimo vale mas.
    const contenido = await readFile(filePath, 'utf8');
    expect(contenido).toBe('cccc\ndddd\n');
    expect(result.trimmed).toBe(true);
    expect(result.newSize).toBe(contenido.length);
    expect(result.droppedBytes).toBe(20 - contenido.length);
  });

  it('never leaves a half line at the start', async () => {
    const filePath = join(dir, 'Archivo.log');
    await writeFile(filePath, 'primera-linea-larga\nsegunda\n', 'utf8');

    // El corte cae en mitad de «segunda», asi que la cola empieza partida.
    await trimLogFileToTail(filePath, 10);

    const contenido = await readFile(filePath, 'utf8');
    expect(contenido.startsWith('segunda')).toBe(true);
    expect(
      contenido
        .split('\n')
        .filter(Boolean)
        .every((l) => l === 'segunda'),
    ).toBe(true);
  });

  it('reports nothing to do when the file does not exist', async () => {
    const result = await trimLogFileToTail(join(dir, 'no-existe.log'), 10);

    expect(result).toEqual({ trimmed: false, droppedBytes: 0, newSize: 0 });
  });
});
