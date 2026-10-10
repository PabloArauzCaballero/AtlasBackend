import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveGeneratedAdminPassword } from '../../../src/database/dev-admin-password-file.js';

describe('saveGeneratedAdminPassword', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atlas-pw-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('guarda la contraseña en un archivo 600 y devuelve su ruta, sin imprimirla', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const file = saveGeneratedAdminPassword('secreta-de-prueba', dir);
    expect(readFileSync(file, 'utf8')).toBe('secreta-de-prueba\n');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
