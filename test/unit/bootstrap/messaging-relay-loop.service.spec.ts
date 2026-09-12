/**
 * @file AT-057/AT-059 — el bucle del relay del piloto: sin solape, sin morir por un fallo, y cercado.
 * @business El worker late cada pocos segundos; si un tick tarda más que el intervalo, el siguiente se salta
 *   (no se duplica el trabajo). Un fallo del relay se registra y el bucle sigue vivo. Mientras el piloto no
 *   sea dueño, el resultado dice `fenced` y no reclama nada.
 * @system Doble del `OutboxRelayService`; sin base ni Nest.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { MESSAGING_CONTEXT, MESSAGING_OWNER_ID, MessagingRelayLoopService } from '../../../src/bootstrap/messaging-relay-loop.service.js';
import type { OutboxRelayService, RelayRunResult } from '../../../src/platform/events/outbox-relay.service.js';

const fenced: RelayRunResult = { fenced: true, claimed: 0, published: 0, retried: 0, deadLettered: 0, quarantined: 0, eventIds: [] };
const published: RelayRunResult = { ...fenced, fenced: false, claimed: 2, published: 2, eventIds: ['a', 'b'] };

function loopWith(run: (input: unknown) => Promise<RelayRunResult>) {
  const relay = { run: jest.fn(run) } as unknown as OutboxRelayService;
  return { loop: new MessagingRelayLoopService(relay), relay: relay as unknown as { run: jest.Mock } };
}

describe('bucle del relay de Mensajería', () => {
  it('cada tick reclama con la identidad y el contexto del piloto', async () => {
    const { loop, relay } = loopWith(async () => published);
    expect(await loop.tick()).toEqual(published);
    expect(relay.run).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: null, ownership: { context: MESSAGING_CONTEXT, owner: MESSAGING_OWNER_ID } }),
    );
    expect(String((relay.run.mock.calls[0][0] as { workerId: string }).workerId)).toContain(MESSAGING_OWNER_ID);
    expect(loop.status()).toEqual(published);
  });

  it('mientras el dueño sea otro, el tick devuelve `fenced` y no reclama nada', async () => {
    const { loop } = loopWith(async () => fenced);
    const result = await loop.tick();
    expect(result).toMatchObject({ fenced: true, claimed: 0 });
  });

  it('no solapa: si un tick sigue en curso, el siguiente se salta y no llama al relay otra vez', async () => {
    let release = (): void => undefined;
    let blocked = true;
    const { loop, relay } = loopWith(async () => {
      // Sólo el PRIMER tick se queda colgado: los siguientes resuelven al momento, para que la prueba
      // pueda comprobar que el bucle vuelve a admitir trabajo sin quedarse esperando para siempre.
      if (blocked) {
        blocked = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return published;
    });
    const inFlight = loop.tick();
    expect(await loop.tick()).toBeNull();
    release();
    expect(await inFlight).toEqual(published);
    expect(relay.run).toHaveBeenCalledTimes(1);
    // Tras terminar, el bucle vuelve a admitir trabajo.
    expect(await loop.tick()).toEqual(published);
    expect(relay.run).toHaveBeenCalledTimes(2);
  });

  it('un fallo del relay no tumba el bucle: devuelve null y conserva el último resultado bueno', async () => {
    let boom = false;
    const { loop } = loopWith(async () => {
      if (boom) throw new Error('la base no responde');
      return published;
    });
    expect(await loop.tick()).toEqual(published);
    boom = true;
    expect(await loop.tick()).toBeNull();
    expect(loop.status()).toEqual(published);
  });

  it('el temporizador se registra al iniciar y se limpia al destruir el módulo', () => {
    const { loop } = loopWith(async () => published);
    expect(loop.status()).toBeNull();
    loop.onModuleInit();
    loop.onModuleDestroy();
    // Si el intervalo quedara vivo, jest avisaría de un handle abierto al cerrar la suite.
    expect(loop.status()).toBeNull();
  });
});
