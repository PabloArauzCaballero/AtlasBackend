/**
 * @file Puente atómico heredado del alta de clientes (AT-015).
 * @business El alta escribe credenciales (auth), consentimientos (consents), cliente y contactos
 *   (customers), flujo de onboarding y sesión de dispositivo (sessions) en UNA transacción. Eso es
 *   correcto para el negocio y no se cambia; lo que cambia es que ahora tiene nombre, dueño, alcance
 *   declarado y fecha de retirada, en vez de ser un `sequelize.transaction` anónimo.
 * @system Único punto autorizado para abrir la transacción compartida del alta. La excepción
 *   `onboarding-atomic-bridge` de `config/architecture/boundaries.json` apunta aquí. El puente NO se
 *   declara extraíble: su sustitución distribuida (estados provisionales, compensaciones) es una
 *   decisión de producto pendiente, no un cambio cosmético.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

/** Alcance declarado: lo que la transacción del alta puede tocar. Cualquier ampliación se revisa aquí. */
export const LEGACY_ONBOARDING_ATOMIC_SCOPE = Object.freeze({
  id: 'onboarding-atomic-bridge',
  owner: 'datos',
  retirementTask: 'AT-025',
  modules: ['customer-onboarding', 'customers', 'auth', 'consents', 'sessions'] as const,
  tables: [
    'customer.customers',
    'customer.customer_contact_methods',
    'customer.customer_profile_versions',
    'telemetry.onboarding_flows',
    'iam.auth_credentials',
    'privacy.customer_consents',
    'telemetry.customer_sessions',
    'telemetry.customer_device_links',
  ] as const,
  extractable: false,
});

@Injectable()
export class LegacyOnboardingAtomicBridge {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  /**
   * Ejecuta el grupo atómico del alta. El callback recibe la transacción porque los repositorios
   * heredados aún la piden por parámetro; ese es exactamente el legado que este puente acota, y la
   * razón por la que no se declara extraíble. Un fallo en cualquier etapa revierte todas.
   */
  run<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(work);
  }
}
