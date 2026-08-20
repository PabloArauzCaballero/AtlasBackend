import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

/**
 * El script de redespliegue, ejercitado contra un doble de la API de Render.
 *
 * ## Qué se prueba y por qué así
 *
 * Lo único que este script aporta sobre el auto-deploy nativo de Render es su **desenlace**: pedir
 * la imagen reconstruida, seguir el despliegue y salir en rojo cuando no llega a estar en línea. Un
 * spec que espiara funciones internas no diría nada de eso; lo que hay que comprobar es el código de
 * salida del proceso y lo que sale por el cable. Así que se ejecuta el script de verdad, con un
 * servidor local haciendo de Render, y se asertan sus dos salidas observables: el `exit code` y el
 * cuerpo del POST.
 *
 * El caso que justifica el spec entero es `build_failed → exit 1`. Un fallo de despliegue que
 * devuelve 0 deja el commit en verde y el servicio corriendo la versión anterior sin que nadie se
 * entere, que es el modo de fallo silencioso que este script existe para cerrar.
 */

const SCRIPT = resolve(__dirname, '../../../scripts/deploy/render-redeploy.mjs');
const SERVICE_ID = 'srv_test';

interface DoubleState {
  /** Estados que devuelve el sondeo, en orden; el último se repite si se pregunta de más. */
  statuses: string[];
  postBody?: Record<string, unknown>;
  authHeader?: string;
}

function startRenderDouble(state: DoubleState): Promise<{ server: Server; port: number }> {
  let polls = 0;
  const server = createServer((req, res) => {
    const json = (payload: unknown, code = 200): void => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    state.authHeader = req.headers.authorization;

    if (req.method === 'GET' && req.url === `/services/${SERVICE_ID}`) {
      json({ name: 'atlas-backend-dev', type: 'web_service', branch: 'dev' });
      return;
    }
    if (req.method === 'POST' && req.url === `/services/${SERVICE_ID}/deploys`) {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        state.postBody = JSON.parse(body) as Record<string, unknown>;
        json({ id: 'dep_1', status: 'created' }, 201);
      });
      return;
    }
    if (req.method === 'GET' && req.url === `/services/${SERVICE_ID}/deploys/dep_1`) {
      json({ id: 'dep_1', status: state.statuses[Math.min(polls++, state.statuses.length - 1)] });
      return;
    }
    json({ message: 'no encontrado' }, 404);
  });

  return new Promise((ready) => {
    server.listen(0, '127.0.0.1', () => ready({ server, port: (server.address() as AddressInfo).port }));
  });
}

async function runScript(port: number, overrides: Record<string, string> = {}): Promise<{ code: number | null; output: string }> {
  const child = spawn(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      RENDER_API_BASE: `http://127.0.0.1:${port}`,
      RENDER_API_KEY: 'rnd_test',
      RENDER_SERVICE_ID: SERVICE_ID,
      RENDER_COMMIT_ID: 'abc1234567890',
      // Sondeo rápido: la espera es lo que se prueba, y a 10 s por vuelta el spec duraría medio minuto.
      RENDER_POLL_MS: '20',
      RENDER_TIMEOUT_MS: '3000',
      ...overrides,
    },
  });

  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const code = await new Promise<number | null>((done) => child.on('exit', done));
  return { code, output };
}

describe('scripts/deploy/render-redeploy.mjs', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  async function withDouble(statuses: string[], overrides?: Record<string, string>) {
    const state: DoubleState = { statuses };
    const started = await startRenderDouble(state);
    server = started.server;
    const result = await runScript(started.port, overrides);
    return { ...result, state };
  }

  it('pide caché limpia y el commit exacto, y sale en verde cuando el despliegue queda en línea', async () => {
    const { code, state } = await withDouble(['build_in_progress', 'update_in_progress', 'live']);

    expect(code).toBe(0);
    // `clear` es lo que fuerza la reconstrucción de la imagen; sin esto el despliegue puede
    // levantarse con capas viejas y parecer nuevo.
    expect(state.postBody).toEqual({ clearCache: 'clear', commitId: 'abc1234567890' });
    expect(state.authHeader).toBe('Bearer rnd_test');
  });

  it('sale en rojo cuando el despliegue falla, en vez de dar el push por bueno', async () => {
    const { code, output } = await withDouble(['build_in_progress', 'build_failed']);

    expect(code).toBe(1);
    expect(output).toContain('build_failed');
  });

  it('sale en rojo si el despliegue no termina dentro del plazo', async () => {
    // Un despliegue colgado no se da por exitoso: se informa el último estado conocido.
    const { code, output } = await withDouble(['build_in_progress'], { RENDER_TIMEOUT_MS: '200' });

    expect(code).toBe(1);
    expect(output).toContain('no terminó');
    expect(output).toContain('build_in_progress');
  });

  it('reutiliza la caché sólo cuando se pide explícitamente', async () => {
    const { code, state } = await withDouble(['live'], { RENDER_CLEAR_CACHE: 'false' });

    expect(code).toBe(0);
    expect(state.postBody).toMatchObject({ clearCache: 'do_not_clear' });
  });

  it('falla con un mensaje de configuración, no con un error de la API, si falta la clave', async () => {
    const { code, output } = await withDouble(['live'], { RENDER_API_KEY: '' });

    expect(code).toBe(1);
    expect(output).toContain('RENDER_API_KEY');
  });

  it('propaga el cuerpo del error de Render para poder distinguir un 404 de un 403', async () => {
    const { code, output } = await withDouble(['live'], { RENDER_SERVICE_ID: 'srv_inexistente' });

    expect(code).toBe(1);
    expect(output).toContain('404');
    expect(output).toContain('no encontrado');
  });
});
