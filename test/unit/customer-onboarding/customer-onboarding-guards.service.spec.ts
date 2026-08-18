import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { CustomerOnboardingGuardsService } from '../../../src/modules/customer-onboarding/application/customer-onboarding-guards.service.js';

/**
 * Validaciones de admisión del registro.
 *
 * La regla de consentimientos estuvo incompleta durante todo el proyecto sin que ningún test lo
 * notara: solo se comprobaban los consentimientos ENVIADOS (que vinieran `granted: true` y que su
 * documento existiera), nunca que estuvieran TODOS los obligatorios del tenant. Bastaba mandar uno
 * para pasar el control y quedar registrado sin haber aceptado los términos imprescindibles.
 */
describe('CustomerOnboardingGuardsService', () => {
  function build() {
    const customersRepository = { findByContactHash: jest.fn(async (..._args: unknown[]) => null) };
    const consentsRepository = {
      findActiveDocumentById: jest.fn(async (..._args: unknown[]) => ({ id: 'doc-1' })),
      findRequiredActiveDocuments: jest.fn(async (..._args: unknown[]) => []),
    };
    const service = new CustomerOnboardingGuardsService(customersRepository as never, consentsRepository as never);
    return { service, customersRepository, consentsRepository };
  }

  describe('assertNoDuplicateCustomer', () => {
    it('pasa cuando no hay ningún cliente con ese teléfono o correo', async () => {
      const { service } = build();
      await expect(service.assertNoDuplicateCustomer('t1', 'phone-hash', 'email-hash')).resolves.toBeUndefined();
    });

    it('rechaza con CUSTOMER_ALREADY_EXISTS cuando ya existe', async () => {
      const { service, customersRepository } = build();
      (customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce({ id: 'existing' } as never);
      await expect(service.assertNoDuplicateCustomer('t1', 'phone-hash', null)).rejects.toThrow(ConflictException);
    });
  });

  describe('assertConsentDocumentsAreValid', () => {
    const granted = (id: string) => ({ consentDocumentId: id, purposeCode: 'terms', granted: true });

    const declined = (id: string) => ({ consentDocumentId: id, purposeCode: 'marketing', granted: false });

    it('rechaza cuando se declina un consentimiento OBLIGATORIO del tenant', async () => {
      const { service, consentsRepository } = build();
      (consentsRepository.findRequiredActiveDocuments as jest.Mock).mockResolvedValueOnce([{ id: '1' }] as never);
      await expect(service.assertConsentDocumentsAreValid('t1', [declined('1')] as never)).rejects.toThrow(/REQUIRED_CONSENT_MISSING/);
    });

    /**
     * Un consentimiento que no se puede negar no es un consentimiento: declinar un documento
     * OPCIONAL (marketing) no puede impedir abrir la cuenta. Antes cualquier `granted: false`
     * rechazaba el registro entero y la rama `'declined'` de `recordConsents` era inalcanzable.
     */
    it('acepta declinar un consentimiento OPCIONAL sin bloquear el registro', async () => {
      const { service, consentsRepository } = build();
      (consentsRepository.findRequiredActiveDocuments as jest.Mock).mockResolvedValueOnce([{ id: '1' }] as never);
      await expect(service.assertConsentDocumentsAreValid('t1', [granted('1'), declined('9')] as never)).resolves.toBeUndefined();
    });

    /** Mencionar un obligatorio con `granted: false` no puede satisfacerlo por el solo hecho de nombrarlo. */
    it('no da por cubierto un obligatorio enviado sin otorgar', async () => {
      const { service, consentsRepository } = build();
      (consentsRepository.findRequiredActiveDocuments as jest.Mock).mockResolvedValueOnce([{ id: '1' }, { id: '2' }] as never);
      await expect(service.assertConsentDocumentsAreValid('t1', [granted('1'), declined('2')] as never)).rejects.toThrow(
        /REQUIRED_CONSENT_MISSING/,
      );
    });

    it('rechaza cuando un documento referenciado no está publicado ni vigente', async () => {
      const { service, consentsRepository } = build();
      (consentsRepository.findActiveDocumentById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.assertConsentDocumentsAreValid('t1', [granted('1')] as never)).rejects.toThrow(UnprocessableEntityException);
    });

    /** Regresión del hueco principal: enviar UNO cuando el tenant exige DOS ya no alcanza. */
    it('rechaza cuando falta un consentimiento obligatorio del tenant, aunque lo enviado sea válido', async () => {
      const { service, consentsRepository } = build();
      (consentsRepository.findRequiredActiveDocuments as jest.Mock).mockResolvedValueOnce([{ id: '1' }, { id: '2' }] as never);

      await expect(service.assertConsentDocumentsAreValid('t1', [granted('1')] as never)).rejects.toThrow(/REQUIRED_CONSENT_MISSING: 2/);
    });

    it('acepta cuando se otorgaron todos los obligatorios', async () => {
      const { service, consentsRepository } = build();
      (consentsRepository.findRequiredActiveDocuments as jest.Mock).mockResolvedValueOnce([{ id: '1' }, { id: '2' }] as never);

      await expect(service.assertConsentDocumentsAreValid('t1', [granted('1'), granted('2')] as never)).resolves.toBeUndefined();
    });

    it('acepta cuando el tenant no declara ningún consentimiento obligatorio', async () => {
      const { service } = build();
      await expect(service.assertConsentDocumentsAreValid('t1', [granted('1')] as never)).resolves.toBeUndefined();
    });
  });
});
