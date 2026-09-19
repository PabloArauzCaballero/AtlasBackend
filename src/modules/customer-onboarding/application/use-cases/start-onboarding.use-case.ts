/**
 * @file Caso de uso: iniciar el alta (AT-025). Orquesta preparación → registro atómico → respuesta.
 * @business Antes de escribir: sin duplicados y consentimientos válidos; el hash de la contraseña se
 *   calcula fuera de la transacción (es CPU cara y no debe sostener bloqueos). Después: identificadores
 *   serializables. Los efectos externos (OTP) los dispara quien llama, nunca dentro del registro.
 * @system Depende de puertos: guardas de preparación, registro atómico y reloj. El servicio actual
 *   (`CustomerOnboardingStartService.startOnboarding`) conserva su contrato HTTP y podrá delegar aquí
 *   cuando sus repositorios se envuelvan en el adaptador del puerto (siguiente incremento de AT-025).
 */
import { TracingService } from '../../../../common/observability/tracing.service.js';
import { APP_ATTRIBUTES, SPAN_NAMES } from '../../../../observability/telemetry.constants.js';
import { hashPassword } from '../../../../common/utils/crypto/password.util.js';
import { hashSensitiveText } from '../../../../common/utils/crypto/hash.util.js';
import { ApplicationError } from '../../../../platform/contracts/application-error.js';
import { systemClock } from '../../../../platform/di/clock.js';
import type { Clock } from '../../../../platform/di/clock.js';
import type { StartOnboardingDto } from '../../customer-onboarding.schemas.js';
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
  registration: StartOnboardingDto;
}>;

export class StartOnboardingUseCase {
  constructor(
    private readonly guards: RegistrationGuards,
    private readonly registration: OnboardingRegistrationPort,
    private readonly passwords: PasswordHasher,
    private readonly contacts: ContactHasher,
    private readonly clock: Clock,
    private readonly tracing: TracingService = new TracingService(),
  ) {}

  /**
   * `customer.register` se abre aquí y no en la fachada HTTP: la fachada es 1:1 con
   * `POST /customer-onboarding`, así que un span suyo duplicaría el del servidor. Este caso de uso,
   * en cambio, reparte el alta en tres tramos que hoy no se distinguen —comprobaciones previas,
   * hash de contraseña y escritura atómica— y el segundo es Argon2, que es CPU cara y suele ser el
   * grueso del tiempo de un alta sin que nada lo delate. Los hitos van como EVENTOS y no como
   * spans hijos: marcan instantes dentro de una misma operación, no llamadas a otro componente.
   *
   * Ningún atributo lleva teléfono, correo, contraseña ni sus hashes.
   */
  execute(command: StartOnboardingCommand): Promise<RegistrationResult> {
    return this.tracing.runInSpan(
      SPAN_NAMES.customerRegister,
      {
        [APP_ATTRIBUTES.module]: 'customer-onboarding',
        [APP_ATTRIBUTES.operation]: 'register',
        [APP_ATTRIBUTES.entityType]: 'customer',
        [APP_ATTRIBUTES.tenantId]: command.tenantId,
        'onboarding.source.type': command.sourceType,
      },
      () => this.register(command),
    );
  }

  private async register(command: StartOnboardingCommand): Promise<RegistrationResult> {
    if (!command.idempotencyKey) throw new ApplicationError({ kind: 'invalid', code: 'X-Idempotency-Key header is required.' });
    const phoneHash = command.phone ? this.contacts.hash(command.phone) : null;
    const emailHash = command.email ? this.contacts.hash(command.email) : null;

    // Preparación: fuera de cualquier transacción.
    await this.guards.assertNoDuplicateCustomer(command.tenantId, phoneHash, emailHash);
    await this.guards.assertConsentDocumentsAreValid(command.tenantId, command.consents);
    this.tracing.addEvent('guards.passed');
    const passwordHash = await this.passwords.hash(command.password);
    this.tracing.addEvent('password.hashed');

    // Persistencia compuesta: UNA llamada al puerto atómico. La contraseña en claro NO cruza el puerto.
    const { password: _plain, ...registration } = command.registration;
    void _plain;
    return this.registration.register({
      tenantId: command.tenantId,
      idempotencyKey: command.idempotencyKey,
      registration,
      passwordHash,
      phoneHash,
      emailHash,
      sourceType: command.sourceType,
      ipAddress: command.ipAddress,
      now: this.clock.now(),
    });
  }
}

/** Composición por defecto de la fachada (AT-025): Argon2 y hash de contactos reales, reloj del sistema. */
export function buildStartOnboardingUseCase(
  guards: RegistrationGuards,
  register: OnboardingRegistrationPort['register'],
): StartOnboardingUseCase {
  return new StartOnboardingUseCase(
    guards,
    { register },
    { hash: hashPassword },
    { hash: hashSensitiveText },
    systemClock,
    new TracingService(),
  );
}
