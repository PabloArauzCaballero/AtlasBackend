/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita que un aprovisionamiento pensado para local altere credenciales reales.
 * @system decide si el proceso actual puede crear o alterar roles PostgreSQL.
 */

/**
 * Política de ejecución del aprovisionamiento de roles PostgreSQL.
 *
 * `yarn db:roles:bootstrap` es DDL de CLUSTER: crea roles, cambia contraseñas y reasigna la
 * propiedad de tablas/vistas/secuencias. En desarrollo eso es exactamente lo que queremos (un
 * comando y el entorno queda con privilegio mínimo). En producción es lo contrario de lo que
 * queremos: las credenciales las aprovisiona infraestructura (IaC/DBA) con revisión y registro, y
 * la aplicación no debe tener —ni ejercer— permiso para crear usuarios.
 *
 * Por eso el script no se limita a "avisar": se niega a correr en producción salvo que quien
 * ejecuta lo pida de forma explícita e inequívoca. La decisión vive aquí, separada del script, para
 * poder probarla sin una base de datos delante.
 */
export type ProvisioningDecision =
  | { allowed: true; environment: string; requiresExplicitOptIn: boolean; notice: string }
  | { allowed: false; environment: string; reason: string };

/** Entornos donde el aprovisionamiento idempotente es el flujo normal y no necesita ceremonia. */
const SELF_SERVICE_ENVIRONMENTS: readonly string[] = ['development', 'test'];

/** Bandera que un operador debe pasar a mano para tocar roles fuera de desarrollo/pruebas. */
export const PRODUCTION_OPT_IN_FLAG = '--allow-production';

/**
 * ¿Puede este proceso aprovisionar roles?
 *
 * @param environment  Valor de `NODE_ENV` (o el que use el runner de CI).
 * @param argv         Argumentos crudos del proceso; se busca {@link PRODUCTION_OPT_IN_FLAG}.
 *
 * La bandera NO es un permiso general: solo convierte un "no" en un "sí, bajo tu responsabilidad y
 * queda dicho en la salida". Un `NODE_ENV` desconocido se trata como no-desarrollo (falla cerrado):
 * un typo como `producton` no debe abrir la puerta por accidente.
 */
export function decideProvisioningExecution(environment: string, argv: readonly string[]): ProvisioningDecision {
  const optedIn = argv.includes(PRODUCTION_OPT_IN_FLAG);

  if (SELF_SERVICE_ENVIRONMENTS.includes(environment)) {
    return {
      allowed: true,
      environment,
      requiresExplicitOptIn: false,
      notice: `Entorno "${environment}": aprovisionamiento idempotente permitido.`,
    };
  }

  if (!optedIn) {
    return {
      allowed: false,
      environment,
      reason:
        `NODE_ENV="${environment}" no es un entorno de auto-servicio (${SELF_SERVICE_ENVIRONMENTS.join(', ')}). ` +
        'Crear o alterar roles fuera de desarrollo/pruebas corresponde a infraestructura (IaC/DBA), no al backend: ' +
        'este script cambia contraseñas y reasigna la propiedad de tablas. Aplica ops/postgres/bootstrap-roles.sql ' +
        `con revisión y registro, o —si de verdad es un entorno efímero que tú controlas— repite el comando con ${PRODUCTION_OPT_IN_FLAG}.`,
    };
  }

  return {
    allowed: true,
    environment,
    requiresExplicitOptIn: true,
    notice:
      `⚠️  NODE_ENV="${environment}" con ${PRODUCTION_OPT_IN_FLAG}: se van a CREAR/ALTERAR roles y a REASIGNAR ` +
      'la propiedad de objetos en una base que no es de desarrollo. Asegúrate de que esta ejecución está aprobada y registrada.',
  };
}
