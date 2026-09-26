import { lastValueFrom, of } from 'rxjs';
import { ApiCommandOutboxInterceptor } from '../../../src/modules/runtime-hardening/outbox.interceptor.js';

/**
 * El interceptor escribe un evento por cada mutación y ESPERA a que se escriba antes de responder. En
 * una ruta pública no hay usuario, y el inquilino salía de la cabecera tal cual. `_tenant_id` es BIGINT:
 * con `x-tenant-id: abc` el INSERT falla y la petición termina en 500 después de que el manejador ya
 * hiciera su trabajo. Lo que no parece un id se trata como «sin inquilino», que el consumidor recoge.
 */
function correr(headers: Record<string, string>, user?: { tenantId: string }) {
  const emitidos: Array<{ tenantId: string | null }> = [];
  const runtime = { emitApiCommandCompleted: jest.fn(async (input: { tenantId: string | null }) => void emitidos.push(input)) };
  const interceptor = new ApiCommandOutboxInterceptor(runtime as never);
  const request = { method: 'POST', originalUrl: '/api/v1/internal/auth/refresh', headers, params: {}, user };
  const contexto = { switchToHttp: () => ({ getRequest: () => request }) } as never;
  return lastValueFrom(interceptor.intercept(contexto, { handle: () => of({ ok: true }) })).then(() => emitidos[0]);
}

describe('ApiCommandOutboxInterceptor · de dónde sale el inquilino', () => {
  it('una cabecera que no es un id NO llega al INSERT: se trata como sin inquilino', async () => {
    await expect(correr({ 'x-tenant-id': 'abc' })).resolves.toMatchObject({ tenantId: null });
  });

  it('una cabecera numérica se respeta', async () => {
    await expect(correr({ 'x-tenant-id': '1' })).resolves.toMatchObject({ tenantId: '1' });
  });

  it('sin cabecera, sin inquilino: lo recoge el consumidor desde f263d37', async () => {
    await expect(correr({})).resolves.toMatchObject({ tenantId: null });
  });

  it('el usuario autenticado manda sobre la cabecera, como antes', async () => {
    await expect(correr({ 'x-tenant-id': '7' }, { tenantId: '1' })).resolves.toMatchObject({ tenantId: '1' });
  });

  it('una inyección con aspecto de número pero no lo es tampoco pasa', async () => {
    await expect(correr({ 'x-tenant-id': '1; DROP TABLE x' })).resolves.toMatchObject({ tenantId: null });
  });
});
