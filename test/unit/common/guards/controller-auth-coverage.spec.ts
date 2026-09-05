import { describe, expect, it } from '@jest/globals';
import { APP_GUARD } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../../src/common/decorators/public.decorator.js';
import { JwtAuthGuard } from '../../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../../src/common/guards/roles.guard.js';
import { ROLES_KEY } from '../../../../src/common/decorators/roles.decorator.js';
import { CustomerEvidenceViewController } from '../../../../src/modules/customer-onboarding/customer-evidence-view.controller.js';
import { DecisionArtifactBindingController } from '../../../../src/modules/decision-engine/decision-artifact-binding.controller.js';

/**
 * Regresión de ATL-001 y ATL-002: `@Roles(...)` sin guard no protege nada.
 *
 * ## Qué se rompió
 *
 * Dos controladores declaraban `@Roles('internal_operator', 'risk_analyst', 'admin',
 * 'platform_admin')` y NO aplicaban `@UseGuards`. Como este backend sólo registraba
 * `ThrottlerGuard` como guard global, nadie leía esa metadata: el decorador quedaba como un
 * comentario ejecutable y las rutas respondían sin sesión.
 *
 * No eran rutas menores. `CustomerEvidenceViewController` sirve los BYTES del carnet y la selfie de
 * cualquier cliente —y `resolveCurrentTenant` acepta el tenant por query, así que ni siquiera hacía
 * falta poner cabeceras—. `DecisionArtifactBindingController` decide QUÉ ARTEFACTO evalúa el
 * crédito, la identidad y el riesgo, y su `POST` se aplicaba sin quedar atribuido a nadie, porque
 * `@CurrentUser()` llegaba `undefined`.
 *
 * ## Por qué esta prueba y no una de integración
 *
 * Porque lo que falló es una propiedad ESTÁTICA del controlador —qué guards tiene colgados—, y esa
 * se puede afirmar sin levantar Postgres, Redis ni el almacenamiento de objetos. Una prueba de
 * integración diría lo mismo con veinte veces más andamiaje y se saltaría en cualquier entorno sin
 * stack, que es justo donde hace falta que esto sea rojo.
 *
 * La defensa de verdad son tres capas, y esta prueba cubre la primera y la segunda:
 *   1. los guards colgados de estos dos controladores (aquí),
 *   2. los guards globales de `app.module.ts` (aquí),
 *   3. el gate `yarn check:auth-coverage`, que impide que la superficie pública crezca (en CI).
 */

/** Los guards que Nest guarda en la metadata de la clase al aplicar `@UseGuards(...)`. */
function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata('__guards__', target) as unknown[] | undefined) ?? [];
}

const CONTROLADORES_SENSIBLES = [
  {
    nombre: 'CustomerEvidenceViewController',
    clase: CustomerEvidenceViewController,
    porQue: 'sirve los documentos de identidad y la selfie de un cliente',
  },
  {
    nombre: 'DecisionArtifactBindingController',
    clase: DecisionArtifactBindingController,
    porQue: 'reasigna qué artefacto decide crédito, identidad y riesgo',
  },
] as const;

describe('Cobertura de autenticación de los controladores sensibles (ATL-001, ATL-002)', () => {
  describe.each(CONTROLADORES_SENSIBLES)('$nombre', ({ clase, porQue }) => {
    it(`aplica JwtAuthGuard, porque ${porQue}`, () => {
      expect(guardsOf(clase)).toContain(JwtAuthGuard);
    });

    it('aplica RolesGuard, que es quien lee el @Roles declarado', () => {
      expect(guardsOf(clase)).toContain(RolesGuard);
    });

    it('declara los roles que puede entrar, y no incluye a customer', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, clase) as string[] | undefined;
      expect(roles).toBeDefined();
      expect(roles?.length).toBeGreaterThan(0);
      // El titular ve sus propias fotos desde su expediente en la app; esta es superficie de
      // operación. Que `customer` entrase aquí sería leer el carnet de OTRA persona.
      expect(roles).not.toContain('customer');
    });

    it('no está marcado como público', () => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, clase)).not.toBe(true);
    });
  });
});

describe('Guards globales del backend (ATL-003)', () => {
  /**
   * Se importa dentro del test y no arriba del fichero a propósito: `app.module.ts` arrastra el
   * grafo entero de módulos, y pagar ese import en un fichero que sólo comprueba metadata alarga
   * la suite sin necesidad. Aquí SÍ hace falta, porque lo que se afirma es su lista de proveedores.
   */
  it('registra JwtAuthGuard y RolesGuard como APP_GUARD, para que una ruta nueva nazca cerrada', async () => {
    const { AppModule } = await import('../../../../src/app.module.js');
    const providers = (Reflect.getMetadata('providers', AppModule) as { provide?: unknown; useClass?: unknown }[]) ?? [];
    const guardsGlobales = providers.filter((provider) => provider?.provide === APP_GUARD).map((provider) => provider.useClass);

    expect(guardsGlobales).toContain(JwtAuthGuard);
    expect(guardsGlobales).toContain(RolesGuard);
  });
});
