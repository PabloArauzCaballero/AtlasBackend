import { Reflector } from '@nestjs/core';
import { INTERNAL_PERMISSIONS_KEY } from '../../src/modules/internal-users/internal-permissions.decorator.js';
import { ConsentOperationsController } from '../../src/modules/consents/consent-operations.controller.js';
import { consentDocumentParamsSchema } from '../../src/modules/consents/consents.schemas.js';
import { CatalogGovernanceController } from '../../src/modules/catalog-management/catalog-governance.controller.js';
import { PartnerContractTemplatesController } from '../../src/modules/partner-onboarding/partner-contract-templates.controller.js';
import { contractTemplateParamsSchema } from '../../src/modules/partner-onboarding/partner-operations.schemas.js';

/**
 * Los textos legales (lo que acepta el cliente, lo que firma el comercio) y las políticas de gobierno
 * se protegían sólo por ROL de sesión. `internal_operator` es el rol de soporte, de cobranza y de
 * gobierno de datos a la vez, así que un agente de soporte podía publicar el consentimiento que
 * aceptan los clientes; y el auditor, con `governance.policies.read` en su paquete, veía las entradas
 * en el menú y recibía 403 porque `readonly_auditor` no estaba en la lista.
 *
 * Estas pruebas fijan que cada ruta exige el permiso fino que el catálogo RBAC declara y que el guard
 * que lo comprueba está puesto: sin él los decoradores son metadatos decorativos.
 */
const reflector = new Reflector();

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type AnyController = Function & { prototype: object };

const metodoDe = (controller: AnyController, metodo: string): (() => unknown) =>
  (controller.prototype as Record<string, () => unknown>)[metodo];

const permisoDe = (controller: AnyController, metodo: string): string[] | undefined =>
  reflector.get<string[] | undefined>(INTERNAL_PERMISSIONS_KEY, metodoDe(controller, metodo));

const rolesDe = (controller: AnyController, metodo?: string): string[] => {
  const delMetodo = metodo ? reflector.get<string[] | undefined>('roles', metodoDe(controller, metodo)) : undefined;
  return delMetodo ?? reflector.get<string[] | undefined>('roles', controller) ?? [];
};

const guardsDe = (controller: AnyController): string[] =>
  (reflector.get<Array<{ name: string }> | undefined>('__guards__', controller) ?? []).map((guard) => guard.name);

describe('Textos legales y políticas de gobierno · permiso fino, no sólo rol', () => {
  it.each([
    [ConsentOperationsController, 'list', 'governance.policies.read'],
    [ConsentOperationsController, 'create', 'governance.policies.manage'],
    [ConsentOperationsController, 'update', 'governance.policies.manage'],
    [CatalogGovernanceController, 'getDataGovernancePolicies', 'governance.policies.read'],
    [CatalogGovernanceController, 'upsertDataGovernancePackage', 'governance.policies.manage'],
    [PartnerContractTemplatesController, 'publish', 'governance.policies.manage'],
    [PartnerContractTemplatesController, 'setDefault', 'governance.policies.manage'],
  ] as const)('%p.%s exige %s', (controller, metodo, permiso) => {
    expect(permisoDe(controller, metodo)).toEqual([permiso]);
  });

  it.each([ConsentOperationsController, CatalogGovernanceController, PartnerContractTemplatesController])(
    '%p lleva InternalPermissionsGuard, el último de la cadena',
    (controller) => {
      const guards = guardsDe(controller);
      expect(guards[0]).toBe('JwtAuthGuard');
      expect(guards.indexOf('InternalPermissionsGuard')).toBe(guards.length - 1);
    },
  );

  it('el auditor (readonly_auditor) puede LEER consentimientos y políticas, que su menú le enseña', () => {
    expect(rolesDe(ConsentOperationsController)).toContain('readonly_auditor');
    expect(rolesDe(CatalogGovernanceController, 'getDataGovernancePolicies')).toContain('readonly_auditor');
  });

  it('quien gobierna los datos (sesión internal_operator) llega a publicar el paquete; el permiso decide', () => {
    expect(rolesDe(CatalogGovernanceController, 'upsertDataGovernancePackage')).toEqual(
      expect.arrayContaining(['internal_operator', 'admin']),
    );
  });

  it('las lecturas de riesgo del mismo controlador no ganan un permiso que nadie declaró', () => {
    expect(permisoDe(CatalogGovernanceController, 'getCurrentRiskPolicy')).toBeUndefined();
  });

  it.each([
    [consentDocumentParamsSchema, 'documentId'],
    [contractTemplateParamsSchema, 'templateId'],
  ] as const)('el id de la ruta es un entero positivo: lo demás es 400, no un 500 de PostgreSQL (%#)', (schema, campo) => {
    expect(schema.safeParse({ [campo]: '12' }).success).toBe(true);
    expect(schema.safeParse({ [campo]: 'abc' }).success).toBe(false);
    expect(schema.safeParse({ [campo]: '0' }).success).toBe(false);
  });
});
