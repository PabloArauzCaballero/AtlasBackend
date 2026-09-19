import { describe, expect, it } from '@jest/globals';
import { firstValueFrom, take, toArray } from 'rxjs';
import { SupportRealtimeService } from '../../../src/modules/support/application/support-realtime.service.js';

/**
 * El bus efímero del chat. Sin Redis sigue funcionando dentro del proceso: es la degradación que
 * permite que un entorno sin Redis tenga chat en vivo igual, en vez de no tener chat.
 */
describe('bus de tiempo real de soporte', () => {
  const build = () => new SupportRealtimeService(null);

  it('entrega al que escucha ESA conversación', async () => {
    const service = build();
    const received = firstValueFrom(service.streamFor('1', '10').pipe(take(1)));

    service.emit({ type: 'message.created', tenantId: '1', channelId: '10', payload: { sequence: '3' } });

    const event = await received;
    expect(event.type).toBe('message.created');
    expect(event.payload).toEqual({ sequence: '3' });
    expect(event.emittedAt).toEqual(expect.any(String));
  });

  it('no entrega la conversación de otro canal', async () => {
    const service = build();
    const collected = firstValueFrom(service.streamFor('1', '10').pipe(take(1), toArray()));

    service.emit({ type: 'message.created', tenantId: '1', channelId: '99', payload: { sequence: '1' } });
    service.emit({ type: 'message.created', tenantId: '1', channelId: '10', payload: { sequence: '2' } });

    const events = await collected;
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({ sequence: '2' });
  });

  /** El aislamiento entre tenants vale también para lo efímero: un canal `10` existe en cada uno. */
  it('no cruza tenants aunque coincida el número de canal', async () => {
    const service = build();
    const collected = firstValueFrom(service.streamFor('1', '10').pipe(take(1), toArray()));

    service.emit({ type: 'message.created', tenantId: '2', channelId: '10', payload: { tenant: 'otro' } });
    service.emit({ type: 'message.created', tenantId: '1', channelId: '10', payload: { tenant: 'mio' } });

    const events = await collected;
    expect(events[0]?.payload).toEqual({ tenant: 'mio' });
  });

  it('el hilo SSE separa el tipo del dato y añade el momento', async () => {
    const service = build();
    const received = firstValueFrom(service.sseFor('1', '10').pipe(take(1)));

    service.emit({ type: 'agent.typing', tenantId: '1', channelId: '10', payload: { actorType: 'AGENT' } });

    const event = await received;
    expect(event.type).toBe('agent.typing');
    expect(event.data.actorType).toBe('AGENT');
    expect(event.data.emittedAt).toEqual(expect.any(String));
  });

  it('sin Redis no falla al emitir: el chat en vivo degrada a esta instancia', () => {
    const service = build();
    expect(() => service.emit({ type: 'channel.closed', tenantId: '1', channelId: '10', payload: {} })).not.toThrow();
  });
});
