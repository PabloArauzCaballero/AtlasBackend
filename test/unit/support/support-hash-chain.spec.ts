import { describe, expect, it } from '@jest/globals';
import {
  caseEventHash,
  contentHashOf,
  eventContentHashOf,
  messageIntegrityHash,
  verifyChain,
  type ChainLink,
} from '../../../src/modules/support/domain/support-hash-chain.js';

/** Construye una cadena válida de N eslabones, como la escribiría el repositorio. */
function buildChain(bodies: string[]): { links: ChainLink[]; hashes: string[] } {
  const hashes: string[] = [];
  const links: ChainLink[] = [];
  let previous: string | null = null;

  bodies.forEach((body, index) => {
    const hash = messageIntegrityHash({
      channelId: '10',
      serverSequence: index + 1,
      senderActorType: 'CUSTOMER',
      senderActorId: '77',
      createdAtIso: `2026-08-27T10:0${index}:00.000Z`,
      contentHash: contentHashOf(body),
      previousMessageHash: previous,
    });
    links.push({ integrityHash: hash, previousHash: previous, recomputed: hash });
    hashes.push(hash);
    previous = hash;
  });

  return { links, hashes };
}

describe('hash de contenido', () => {
  it('es estable para el mismo texto', () => {
    expect(contentHashOf('hola')).toBe(contentHashOf('hola'));
  });

  it('normaliza el salto de línea de Windows para no depender del cliente', () => {
    expect(contentHashOf('linea1\r\nlinea2')).toBe(contentHashOf('linea1\nlinea2'));
  });

  it('distingue mayúsculas y espacios: importa lo que se escribió exactamente', () => {
    expect(contentHashOf('Pagué')).not.toBe(contentHashOf('pagué'));
    expect(contentHashOf('pago ')).not.toBe(contentHashOf('pago'));
  });
});

describe('eslabón de integridad del mensaje', () => {
  const base = {
    channelId: '10',
    serverSequence: 5,
    senderActorType: 'AGENT',
    senderActorId: '3',
    createdAtIso: '2026-08-27T10:00:00.000Z',
    contentHash: contentHashOf('texto'),
    previousMessageHash: null as string | null,
  };

  it('cambia si cambia el emisor, aunque el contenido sea idéntico', () => {
    const asAgent = messageIntegrityHash(base);
    const asCustomer = messageIntegrityHash({ ...base, senderActorType: 'CUSTOMER' });
    expect(asAgent).not.toBe(asCustomer);
  });

  it('cambia si cambia la posición en la conversación', () => {
    expect(messageIntegrityHash(base)).not.toBe(messageIntegrityHash({ ...base, serverSequence: 6 }));
  });

  it('cambia si cambia el eslabón anterior: eso es lo que lo hace una cadena', () => {
    const genesis = messageIntegrityHash(base);
    const encadenado = messageIntegrityHash({ ...base, previousMessageHash: 'a'.repeat(64) });
    expect(genesis).not.toBe(encadenado);
  });
});

describe('verificación de la cadena', () => {
  it('una conversación intacta verifica completa', () => {
    const { links } = buildChain(['hola', '¿me ayudas?', 'claro']);
    const result = verifyChain(links);
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(3);
    expect(result.brokenAt).toEqual([]);
  });

  it('detecta que alguien editó el contenido de un mensaje del medio', () => {
    const { links } = buildChain(['hola', 'te devolvemos el dinero', 'gracias']);
    // Se altera el texto del segundo mensaje: su hash recalculado deja de coincidir con el guardado.
    const alterado = messageIntegrityHash({
      channelId: '10',
      serverSequence: 2,
      senderActorType: 'CUSTOMER',
      senderActorId: '77',
      createdAtIso: '2026-08-27T10:01:00.000Z',
      contentHash: contentHashOf('no te devolvemos nada'),
      previousMessageHash: links[0]?.previousHash ?? null,
    });
    const tampered = links.map((link, index) => (index === 1 ? { ...link, recomputed: alterado } : link));

    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toContain(1);
  });

  it('detecta que alguien quitó un mensaje del medio', () => {
    const { links } = buildChain(['uno', 'dos', 'tres']);
    const sinElDelMedio = [links[0]!, links[2]!];

    const result = verifyChain(sinElDelMedio);
    expect(result.valid).toBe(false);
    // El tercero apunta a un padre que ya no está: la ruptura se ve en su posición.
    expect(result.brokenAt).toContain(1);
  });

  it('una cadena vacía es válida: un canal sin mensajes no está manipulado', () => {
    expect(verifyChain([]).valid).toBe(true);
  });
});

describe('eslabón de la historia del caso', () => {
  it('el hash del evento depende de su payload canónico', () => {
    const uno = eventContentHashOf('CASE_ASSIGNED', { agentProfileId: '5', reason: 'skill' });
    const otro = eventContentHashOf('CASE_ASSIGNED', { reason: 'skill', agentProfileId: '5' });
    // Mismo contenido en distinto orden de claves: el hash no debe cambiar por eso.
    expect(uno).toBe(otro);
    expect(uno).not.toBe(eventContentHashOf('CASE_ASSIGNED', { agentProfileId: '6', reason: 'skill' }));
  });

  it('encadena los eventos igual que los mensajes', () => {
    const primero = caseEventHash({
      caseId: '1',
      sequenceNumber: 1,
      eventType: 'CASE_CREATED',
      actorType: 'CUSTOMER',
      actorId: '77',
      occurredAtIso: '2026-08-27T10:00:00.000Z',
      contentHash: eventContentHashOf('CASE_CREATED', {}),
      previousHash: null,
    });
    const segundo = caseEventHash({
      caseId: '1',
      sequenceNumber: 2,
      eventType: 'CASE_ASSIGNED',
      actorType: 'AGENT',
      actorId: '3',
      occurredAtIso: '2026-08-27T10:05:00.000Z',
      contentHash: eventContentHashOf('CASE_ASSIGNED', { agentProfileId: '3' }),
      previousHash: primero,
    });
    expect(primero).toHaveLength(64);
    expect(segundo).not.toBe(primero);
  });
});
