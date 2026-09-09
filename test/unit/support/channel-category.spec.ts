import { describe, expect, it } from '@jest/globals';
import { SupportActorService } from '../../../src/modules/support/application/support-actor.service.js';
import type { SupportActor } from '../../../src/modules/support/application/support-actor.service.js';
import { SupportCaseService } from '../../../src/modules/support/application/support-case.service.js';

/**
 * El motivo que la persona elige al abrir el chat tiene que llegar al EXPEDIENTE.
 *
 * Antes sólo servía para elegir la cola: `requestChannel` lo leía, enrutaba con él y después creaba
 * el caso siempre en `OTHER`. El efecto es el que la auditoría del 4-sep atribuyó a que nadie
 * elegía motivo — la analítica salía vacía—, pero la causa era otra y peor: la elección se hacía y
 * se tiraba. Un selector de motivo en la app o en el portal de comercio no habría cambiado nada.
 *
 * La segunda regla que se fija aquí es la asimetría con `openCase`: un motivo que no le corresponde
 * al actor **no rechaza la conversación**, cae a `OTHER`. Abrir un caso sí rechaza, porque allí el
 * motivo es el dato principal; aquí la persona está pidiendo ayuda y dejarla sin hablar por un
 * código cacheado de una versión vieja del cliente sería un fallo nuestro cobrado a ella.
 */
type CategoriaFalsa = { categoryCode: string; audience: string; label: string };

const CATALOGO: CategoriaFalsa[] = [
  { categoryCode: 'OTHER', audience: 'ANY', label: 'Otro motivo' },
  { categoryCode: 'PAYMENTS', audience: 'CONSUMER', label: 'Pagos y cuotas' },
  { categoryCode: 'PARTNER_BILLING', audience: 'PARTNER_USER', label: 'Facturación y comisiones' },
];

/** Sólo dos colaboradores participan en la decisión; el resto no se toca en esta ruta. */
function servicio() {
  const catalog = {
    findCategoryByCode: async (_tenantId: string, categoryCode: string) =>
      CATALOGO.find((categoria) => categoria.categoryCode === categoryCode) ?? null,
  };
  const actors = new SupportActorService(null as never, null as never);
  return new SupportCaseService(null as never, catalog as never, null as never, null as never, null as never, null as never, actors);
}

function actor(overrides: Partial<SupportActor>): SupportActor {
  return {
    actorType: 'CUSTOMER',
    actorId: 'cust-1',
    customerId: '1',
    isInternal: false,
    isSupervisor: false,
    ...overrides,
  } as SupportActor;
}

const consumidor = actor({ actorType: 'CUSTOMER' });
const comercio = actor({ actorType: 'PARTNER_USER', customerId: null, actorId: 'pu-1' });

/** El método es privado a propósito: la prueba mide la REGLA, no la forma de invocarla. */
function resolver(categoryCode: string | null | undefined, quien: SupportActor) {
  const instancia = servicio() as unknown as {
    resolveChannelCategory: (
      tenantId: string,
      actor: SupportActor,
      categoryCode: string | null | undefined,
      transaction: unknown,
    ) => Promise<CategoriaFalsa | null>;
  };
  return instancia.resolveChannelCategory('1', quien, categoryCode, null);
}

describe('el motivo con el que se abre una conversación', () => {
  it('usa el motivo elegido cuando le corresponde a quien lo elige', async () => {
    await expect(resolver('PAYMENTS', consumidor)).resolves.toMatchObject({ categoryCode: 'PAYMENTS' });
    await expect(resolver('PARTNER_BILLING', comercio)).resolves.toMatchObject({ categoryCode: 'PARTNER_BILLING' });
  });

  it('cae a OTHER cuando no se eligió ninguno', async () => {
    await expect(resolver(null, consumidor)).resolves.toMatchObject({ categoryCode: 'OTHER' });
    await expect(resolver(undefined, consumidor)).resolves.toMatchObject({ categoryCode: 'OTHER' });
  });

  /**
   * Un consumidor pidiendo el motivo del comercio no es un ataque interesante —el motivo no da
   * acceso a nada— pero sí ensuciaría la analítica y enrutaría a la cola equivocada.
   */
  it('cae a OTHER cuando el motivo es de otra audiencia, sin rechazar la conversación', async () => {
    await expect(resolver('PARTNER_BILLING', consumidor)).resolves.toMatchObject({ categoryCode: 'OTHER' });
    await expect(resolver('PAYMENTS', comercio)).resolves.toMatchObject({ categoryCode: 'OTHER' });
  });

  it('cae a OTHER cuando el motivo no existe en el catálogo', async () => {
    await expect(resolver('MOTIVO_INVENTADO', consumidor)).resolves.toMatchObject({ categoryCode: 'OTHER' });
  });

  /**
   * `ANY` sirve a los tres públicos: es lo que permite que la red de seguridad funcione tanto para
   * un cliente como para un usuario de comercio.
   */
  it('acepta un motivo de audiencia ANY para cualquiera', async () => {
    await expect(resolver('OTHER', comercio)).resolves.toMatchObject({ categoryCode: 'OTHER' });
  });
});
