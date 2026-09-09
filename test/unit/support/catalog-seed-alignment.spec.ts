import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { SUPPORT_QUEUE_CODES } from '../../../src/modules/support/support.constants.js';

/**
 * El catálogo sembrado y el código tienen que hablar de las mismas colas.
 *
 * El enrutado no busca «una cola de consumidores»: busca `consumer_l1` por su código exacto, y si no
 * la encuentra, `requireQueueByCode` lanza `SUPPORT_QUEUE_NOT_FOUND` al abrir el caso. Lo mismo con
 * el escalado (`consumer_l2`, `security_fraud`, `privacy`), con la política de SLA
 * (`atlas_support_default`) y con la categoría de red de seguridad (`OTHER`), que es la que evita
 * que una conversación se quede sin expediente.
 *
 * Ese acoplamiento por cadena de texto es invisible: renombrar una cola en la migración —o añadir
 * un código nuevo a `SUPPORT_QUEUE_CODES` sin sembrarlo— compila, pasa el type-check y sólo falla en
 * ejecución, cuando alguien intenta pedir ayuda. Estas pruebas leen la migración y comparan.
 */
const MIGRACION = readFileSync(join(process.cwd(), 'src/database/migrations/20260909150000-seed-support-catalog.ts'), 'utf8');

/**
 * Los `code:` del arreglo de colas, que es el único sitio de la migración donde aparecen así.
 *
 * La clase de caracteres incluye dígitos porque tres de los ocho códigos los llevan (`consumer_l1`,
 * `consumer_l2`, `partner_l1`). Sin ellos la prueba pasaba de largo justo por las tres colas que más
 * usa el enrutado, que es la peor forma de fallar: silenciosa y en lo importante.
 */
function codigosSembrados(seccion: string): string[] {
  const bloque = MIGRACION.slice(MIGRACION.indexOf(seccion));
  const fin = bloque.indexOf('\n}');
  return [...bloque.slice(0, fin).matchAll(/code: '([a-z0-9_]+)'/g)].map((coincidencia) => coincidencia[1]);
}

describe('catálogo de soporte sembrado', () => {
  it('siembra exactamente las ocho colas que el código busca por código', () => {
    const sembradas = codigosSembrados('async function seedQueues');
    const esperadas = Object.values(SUPPORT_QUEUE_CODES);

    expect([...sembradas].sort()).toEqual([...esperadas].sort());
  });

  /**
   * `support-case.service.ts` declara este código como constante privada y lo usa como respaldo
   * cuando la cola no trae política propia. Si la migración sembrara otro nombre, el reloj de SLA no
   * se pondría nunca y el indicador de cumplimiento saldría falsamente perfecto — el mismo fallo
   * silencioso que la auditoría del 4-sep encontró con el barrido sin programar.
   */
  it('siembra la política de SLA con el código que el servicio usa por defecto', () => {
    const servicio = readFileSync(join(process.cwd(), 'src/modules/support/application/support-case.service.ts'), 'utf8');
    const enElServicio = /const DEFAULT_SLA_POLICY_CODE = '([a-z_]+)'/.exec(servicio)?.[1];
    const enLaMigracion = /const SLA_POLICY_CODE = '([a-z_]+)'/.exec(MIGRACION)?.[1];

    expect(enElServicio).toBeDefined();
    expect(enLaMigracion).toBe(enElServicio);
  });

  it('siembra las cuatro prioridades, porque la política se busca por prioridad', () => {
    for (const prioridad of ['P1', 'P2', 'P3', 'P4']) {
      expect(MIGRACION).toContain(`priority: '${prioridad}'`);
    }
  });

  /**
   * `createUnclassifiedCase` busca esta categoría por su código para que ningún chat quede sin
   * expediente. Sin la fila, el arreglo de la fase B2 deja de funcionar sin decir nada.
   */
  it('siembra la categoría de red de seguridad que la conversación sin motivo necesita', () => {
    const servicio = readFileSync(join(process.cwd(), 'src/modules/support/application/support-case.service.ts'), 'utf8');
    const enElServicio = /const UNCLASSIFIED_CATEGORY_CODE = '([A-Z_]+)'/.exec(servicio)?.[1];

    expect(enElServicio).toBeDefined();
    expect(MIGRACION).toContain(`code: '${enElServicio}'`);
  });

  /**
   * Toda categoría apunta a una cola por código. Una que apuntara a una cola no sembrada quedaría
   * con `default_queue_id` NULL —el `SELECT` anidado no encuentra nada— y sus casos nacerían sin
   * cola, invisibles en la bandeja filtrada por cola de cualquier agente.
   */
  it('ninguna categoría apunta a una cola que no se siembre', () => {
    const colas = new Set<string>(Object.values(SUPPORT_QUEUE_CODES));
    const referenciadas = [...MIGRACION.matchAll(/queue: '([a-z0-9_]+)'/g)].map((coincidencia) => coincidencia[1]);

    expect(referenciadas.length).toBeGreaterThan(0);
    expect([...new Set(referenciadas)].filter((cola) => !colas.has(cola))).toEqual([]);
  });

  /** Un submotivo sin raíz sembrada quedaría colgando en el nivel superior del árbol, sin avisar. */
  it('todo submotivo cuelga de una raíz que también se siembra', () => {
    const raices = new Set([...MIGRACION.matchAll(/^\s{4}code: '([A-Z_]+)',$/gm)].map((c) => c[1]));
    const padres = [...MIGRACION.matchAll(/parent: '([A-Z_]+)'/g)].map((c) => c[1]);

    expect(padres.length).toBeGreaterThan(0);
    expect([...new Set(padres)].filter((padre) => !raices.has(padre))).toEqual([]);
  });
});
