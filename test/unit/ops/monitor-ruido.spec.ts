import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

/**
 * Los avisos del monitor de TEST no pueden volver a inundar el chat ni dar falsos positivos de SSH.
 *
 * 2026-10-19: un Redis en bucle de reinicios mandó ~200 avisos «REINICIO» (uno por minuto, con el contador
 * acumulado) y la entrada de Coolify por SSH saltó como «NUEVA» porque su IP de Docker cambia en cada
 * redespliegue. Se ejecutan las funciones reales de `ops/contabo-test/monitor/ruido.sh` con `sh`.
 */
const RUIDO = join(process.cwd(), 'ops/contabo-test/monitor/ruido.sh');

// Las rutas viajan por entorno (`$RUIDO_SH`, `$E`), nunca pegadas dentro del comando de shell.
const sh = (script: string, env: Record<string, string> = {}) =>
  spawnSync('sh', ['-c', script], { encoding: 'utf8', env: { ...process.env, RUIDO_SH: RUIDO, ...env } });

const key = (dir: string, name: string, comment: string): string => {
  const file = join(dir, name);
  const gen = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', file]);
  expect(gen.status).toBe(0);
  const fp = spawnSync('ssh-keygen', ['-lf', `${file}.pub`], { encoding: 'utf8' }).stdout.split(' ')[1]!;
  return fp.slice(0, 20);
};

describe('aviso_reinicio', () => {
  const run = (reinicios: Array<[number, number]>, extra = ''): string[] => {
    const e = mkdtempSync(join(tmpdir(), 'monitor-e-'));
    const calls = reinicios.map(([nuevos, total]) => `aviso_reinicio redis ${nuevos} ${total}`).join('\n');
    const out = sh(`alertar() { echo "$1"; }; . "$RUIDO_SH"; ${extra}\n${calls}`, { E: e });
    expect(out.status).toBe(0);
    return out.stdout.split('\n').filter(Boolean);
  };

  it('avisa una sola vez por ventana aunque el contenedor se reinicie sin parar', () => {
    const avisos = run(Array.from({ length: 200 }, (_, i) => [1, i + 1] as [number, number]));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('REINICIO: redis se reinició 1 vez/veces');
  });

  it('al cerrarse la ventana resume lo acumulado en un solo aviso', () => {
    const e = mkdtempSync(join(tmpdir(), 'monitor-e-'));
    const out = sh(
      `alertar() { echo "$1"; }; . "$RUIDO_SH"
       aviso_reinicio redis 1 1; aviso_reinicio redis 5 6; aviso_reinicio redis 4 10
       echo $(( $(date +%s) - 4000 )) > "$E/rst-aviso-redis"
       aviso_reinicio redis 1 11`,
      { E: e },
    );
    const avisos = out.stdout.split('\n').filter(Boolean);
    expect(avisos).toHaveLength(2);
    expect(avisos[1]).toContain('sigue reiniciándose: 10 veces desde el último aviso (total 11)');
  });

  it('cada contenedor tiene su propia ventana', () => {
    const e = mkdtempSync(join(tmpdir(), 'monitor-e-'));
    const out = sh(`alertar() { echo "$1"; }; . "$RUIDO_SH"; aviso_reinicio a 1 1; aviso_reinicio b 1 1; aviso_reinicio a 1 2`, { E: e });
    expect(out.stdout.split('\n').filter(Boolean)).toHaveLength(2);
  });
});

describe('ssh_de_coolify', () => {
  const dir = mkdtempSync(join(tmpdir(), 'monitor-ssh-'));
  const coolify = key(dir, 'coolify', 'coolify');
  const ajena = key(dir, 'ajena', 'alguien@laptop');
  const authorized = join(dir, 'authorized_keys');
  writeFileSync(authorized, ['coolify.pub', 'ajena.pub'].map((f) => readFileSync(join(dir, f), 'utf8')).join(''));
  const conocida = (ip: string, huella: string): boolean =>
    sh('. "$RUIDO_SH"; ssh_de_coolify "$T_IP" "$T_HUELLA"', { SSH_AUTHORIZED_KEYS: authorized, T_IP: ip, T_HUELLA: huella }).status === 0;

  it('perdona a Coolify desde cualquier IP privada de Docker', () => {
    expect(conocida('10.0.1.24', coolify)).toBe(true);
    expect(conocida('172.18.0.5', coolify)).toBe(true);
  });

  it('no perdona la llave de Coolify desde una IP pública', () => {
    expect(conocida('189.28.75.152', coolify)).toBe(false);
  });

  it('no perdona otra llave autorizada desde una IP privada, ni una llave desconocida', () => {
    expect(conocida('10.0.1.24', ajena)).toBe(false);
    expect(conocida('10.0.1.24', 'SHA256:noexisteenlistaaaa')).toBe(false);
    expect(conocida('10.0.1.24', '')).toBe(false);
  });
});
