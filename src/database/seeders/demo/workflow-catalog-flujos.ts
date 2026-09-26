/**
 * @file Contratos de la siembra demostrativa del repositorio.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
/**
 * Forma de un flujo documentado como ÁRBOL, no como cuatro listas paralelas.
 *
 * Desde el 2026-09-26 estos árboles no se siembran: los envuelve una fixture de
 * `src/modules/workflow-catalog/definitions/processes/` y los vuelca la migración
 * `sync-workflow-catalog-N`. Se conservan aquí porque QA los recorre tal cual.
 *
 * Las filas del catálogo viven en cuatro tablas —definición, etapas, pasos y dependencias— y cada
 * fila hija repite la referencia natural a su padre. Escritas a mano, un flujo de veinte etapas son
 * miles de líneas donde el noventa por ciento es la misma referencia copiada, y basta un
 * `stage_code` mal tecleado para que la siembra falle con un mensaje que no dice cuál.
 *
 * Aquí el flujo se declara como se piensa —etapas, y dentro cada paso— y esta función deriva lo
 * demás: el orden de ejecución por posición, la dependencia de cada paso con el anterior de su
 * etapa, y las referencias cruzadas. Lo que se revisa en el diff es el ÁRBOL.
 */

type PasoDeclarado = {
  code: string;
  name: string;
  description: string;
  method: string;
  path: string;
  /** Actor que ejecuta ESTE paso. Un recorrido real mezcla cliente, operador y comercio. */
  roles?: string[];
  auth?: boolean;
  optional?: boolean;
  repeatable?: boolean;
  idempotencyKey?: boolean;
  requiredStates?: string[];
  resultingStates?: string[];
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errors?: string[];
  events?: string[];
  successStatus?: number[];
};

type EtapaDeclarada = {
  code: string;
  name: string;
  description: string;
  module: string;
  actor: 'customer' | 'internal_user' | 'merchant_user' | 'system';
  optional?: boolean;
  entry?: boolean;
  terminal?: boolean;
  roles?: string[];
  requiredStates?: string[];
  resultingStates?: string[];
  steps: PasoDeclarado[];
};

type FlujoDeclarado = {
  code: string;
  version: string;
  name: string;
  description: string;
  processType: string;
  ownerDomain: string;
  success: string;
  failure: string;
  metadata?: Record<string, unknown>;
  stages: EtapaDeclarada[];
};

export type { FlujoDeclarado, EtapaDeclarada, PasoDeclarado };
