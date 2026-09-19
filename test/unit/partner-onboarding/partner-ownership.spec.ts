import { ForbiddenException } from '@nestjs/common';
import { assertOwnPartnerResource } from '../../../src/common/utils/auth/ownership.util.js';
import { PartnerOwnershipGuard } from '../../../src/modules/partner-onboarding/partner-ownership.guard.js';

/**
 * Propiedad del expediente de partner.
 *
 * Hallazgo `authorization` de la revisión de seguridad del 20-ago-2026. Todos los endpoints del
 * onboarding admiten el rol `merchant` y el expediente viaja como `:partnerId` en la URL, pero no
 * existía ninguna comprobación que atara ese expediente a quien llamaba — ni siquiera una columna
 * de dueño contra la que comprobarlo. Un comercio autenticado podía leer y modificar el expediente
 * de CUALQUIER otro comercio del mismo tenant: sus representantes legales, sus terminales y sus QR
 * de cobro, que dicen a qué cuenta va el dinero.
 */
describe('Propiedad del expediente de partner', () => {
  const comercio = (merchantUserId: string) => ({ sub: merchantUserId, role: 'merchant' as const, merchantUserId });

  describe('la regla', () => {
    it('deja pasar al comercio dueño y rechaza al que no lo es', () => {
      expect(() => assertOwnPartnerResource(comercio('7'), '7')).not.toThrow();
      expect(() => assertOwnPartnerResource(comercio('7'), '8')).toThrow(ForbiddenException);
    });

    it('un expediente SIN dueño no es de todos: es de nadie', () => {
      // Los abrió personal interno, o existían antes de que hubiera columna de dueño. Dejarlos
      // abiertos a cualquier comercio reproduciría el mismo agujero para todo el histórico.
      expect(() => assertOwnPartnerResource(comercio('7'), null)).toThrow(ForbiddenException);
    });

    it('los roles internos operan sobre cualquier expediente, con dueño o sin él', () => {
      const interno = { sub: '1', role: 'internal_operator' as const };
      expect(() => assertOwnPartnerResource(interno, '7')).not.toThrow();
      expect(() => assertOwnPartnerResource(interno, null)).not.toThrow();
    });

    it('un token sin identidad de comercio no opera sobre expedientes', () => {
      const sinIdentidad = { sub: '3', role: 'merchant' as const };
      expect(() => assertOwnPartnerResource(sinIdentidad, '7')).toThrow(ForbiddenException);
    });
  });

  describe('el guard que la aplica', () => {
    function contexto(params: Record<string, string>, user: unknown) {
      return {
        switchToHttp: () => ({ getRequest: () => ({ params, user, headers: {} }) }),
      } as never;
    }

    const guard = (owner: string | null) =>
      new PartnerOwnershipGuard({
        findProfileById: jest.fn(async () => ({ ownerMerchantUserId: owner })),
      } as never);

    it('rechaza al comercio que pide el expediente de otro', async () => {
      await expect(guard('8').canActivate(contexto({ partnerId: '10' }, { ...comercio('7'), tenantId: '1' }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('deja pasar al dueño', async () => {
      await expect(guard('7').canActivate(contexto({ partnerId: '10' }, { ...comercio('7'), tenantId: '1' }))).resolves.toBe(true);
    });

    it('no se interpone en las rutas sin expediente: abrir uno no tiene dueño todavía', async () => {
      await expect(guard(null).canActivate(contexto({}, { ...comercio('7'), tenantId: '1' }))).resolves.toBe(true);
    });
  });
});
