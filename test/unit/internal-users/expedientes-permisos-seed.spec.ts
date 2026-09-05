import { describe, expect, it } from '@jest/globals';
import {
  INTERNAL_PERMISSION_SEEDS,
  ROLE_PERMISSION_CODES,
} from '../../../src/modules/internal-users/internal-rbac.permissions.js';

/**
 * Los permisos del expediente están en el catálogo canónico y llegan a quien los necesita.
 *
 * ## Qué defecto guarda
 *
 * En el despliegue, el módulo `expedientes` quedó INALCANZABLE para todos: la función estaba
 * instalada, pero `GET .../contenido` respondía 404 hasta para un SUPER_ADMIN. La causa no era el
 * código de autorización —era que estos cinco permisos no existían en la base—. El catálogo se
 * siembra por migración, y la que lo sincroniza ya se había aplicado antes de que estos permisos
 * existieran, así que en cualquier base viva nunca llegaron.
 *
 * La reparación fue una migración nueva que vuelve a converger el catálogo. Lo que esta prueba
 * protege es el paso previo: que los permisos SIGAN estando en la lista canónica y asignados a los
 * roles que abren un caso. Si alguien los quitara de aquí, la próxima sincronización los borraría y
 * el 404 volvería en silencio para todos — que es exactamente como se manifestó la primera vez.
 */
const PERMISOS_EXPEDIENTES = [
  'expedientes.leer',
  'expedientes.escribir',
  'expedientes.compartir',
  'expedientes.administrar',
  'expedientes.pii.revelar',
] as const;

describe('permisos de expedientes en el catálogo RBAC', () => {
  it('los cinco están en la lista canónica que siembra la migración', () => {
    const codigos = new Set(INTERNAL_PERMISSION_SEEDS.map((p) => p.code));
    for (const permiso of PERMISOS_EXPEDIENTES) {
      expect(codigos.has(permiso)).toBe(true);
    }
  });

  it('SUPER_ADMIN puede leer, escribir, compartir, administrar y revelar', () => {
    // Es el rol del usuario sembrado con el que se opera el portal: si a éste le falta un permiso,
    // no lo tiene nadie y la función vuelve a ser inalcanzable.
    const suyos = new Set(ROLE_PERMISSION_CODES.SUPER_ADMIN ?? []);
    for (const permiso of PERMISOS_EXPEDIENTES) {
      expect(suyos.has(permiso)).toBe(true);
    }
  });

  it('los analistas que revisan casos pueden al menos LEER el expediente', () => {
    // Sin esto, un analista de riesgo o de fraude abre la investigación de un cliente y no puede
    // ver el carnet con el que tiene que decidir — el material y la decisión quedan en pantallas
    // separadas, que es justo lo que el expediente vino a unir.
    for (const rol of ['RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE_ANALYST', 'OPERATIONS_ANALYST'] as const) {
      const suyos = new Set(ROLE_PERMISSION_CODES[rol] ?? []);
      expect(suyos.has('expedientes.leer')).toBe(true);
    }
  });

  it('revelar PII exige un motivo, por catálogo y no por convención', () => {
    const revelar = INTERNAL_PERMISSION_SEEDS.find((p) => p.code === 'expedientes.pii.revelar');
    expect(revelar?.requiresReason).toBe(true);
  });
});
