/**
 * @file Caso de uso: iniciar el alta (AT-025). Orquesta preparación → registro atómico → respuesta.
 * @business Antes de escribir: sin duplicados y consentimientos válidos; el hash de la contraseña se
 *   calcula fuera de la transacción (es CPU cara y no debe sostener bloqueos). Después: identificadores
 *   serializables. Los efectos externos (OTP) los dispara quien llama, nunca dentro del registro.
 * @system Depende de puertos: guardas de preparación, registro atómico y reloj. El servicio actual
 *   (`CustomerOnboardingStartService.startOnboarding`) conserva su contrato HTTP y podrá delegar aquí
 *   cuando sus repositorios se envuelvan en el adaptador del puerto (siguiente incremento de AT-025).
 */
import { ApplicationError } from '../../../../platform/contracts/application-error.js';
import type { Clock } from '../../../../platform/di/clock.js';
import type { OnboardingRegistrationPort, RegistrationResult } from '../ports/onboarding-registration.port.js';

export interface RegistrationGuards {
  assertNoDuplicateCustomer(tenantId: string, phoneHash: string | null, emailHash: string | null): Promise<void>;
  assertConsentDocumentsAreValid(tenantId: string, consents: readonly { consentDocumentId: string }[]): Promise<void>;
}

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
}

export interface ContactHasher {
  hash(value: string): string;
}

export type StartOnboardingCommand = Readonly<{
  tenantId: string;
  idempotencyKey: string;
  password: string;
  phone: string | null;
  email: string | null;
  consents: readonly { consentDocumentId: string }[];
  sourceType: string;
  ipAddress: string | null;
}>;

export class StartOnboardingUseCase {
  constructor(
    private readonly guards: RegistrationGuards,
    private readonly registration: OnboardingRegistrationPort,
    private readonly passwords: PasswordHasher,
    private readonly contacts: ContactHasher,
    private readonly clock: Clock,
  ) {}

  async execute(command: StartOnboardingCommand): Promise<RegistrationResult> {
    if (!command.idempotencyKey) throw new ApplicationError({ kind: 'invalid', code: 'X-Idempotency-Key header is required.' });
    const phoneHash = command.phone ? this.contacts.hash(command.phone) : null;
    const emailHash = command.email ? this.contacts.hash(command.email) : null;

    // Preparación: fuera de cualquier transacción.
    await this.guards.assertNoDuplicateCustomer(command.tenantId, phoneHash, emailHash);
    await this.guards.assertConsentDocumentsAreValid(command.tenantId, command.consents);
    const passwordHash = await this.passwords.hash(command.password);

    // Persistencia compuesta: UNA llamada al puerto atómico.
    return this.registration.register({
      tenantId: command.tenantId,
      idempotencyKey: command.idempotencyKey,
      passwordHash,
      phoneHash,
      emailHash,
      sourceType: command.sourceType,
      ipAddress: command.ipAddress,
      now: this.clock.now(),
    });
  }
}
