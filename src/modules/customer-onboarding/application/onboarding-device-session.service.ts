/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Transaction } from 'sequelize';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { SessionsRepository } from '../../sessions/sessions.repository.js';
import { StartOnboardingDto } from '../customer-onboarding.schemas.js';

/**
 * Dispositivo, sesión inicial e instantánea del dispositivo, dentro del alta de un cliente.
 *
 * Se separó de `CustomerOnboardingStartService` porque es la única parte del registro que no toca al
 * cliente ni a su expediente: resuelve la huella del dispositivo en sus tres niveles —global, del
 * tenant y el vínculo con el cliente—, abre la sesión y guarda lo que el aparato declara de sí
 * mismo. Todo eso habla con un solo repositorio y se entiende sin leer el resto del alta.
 */
@Injectable()
export class OnboardingDeviceSessionService {
  constructor(private readonly sessionsRepository: SessionsRepository) {}

  /**
   * Deja al cliente recién creado con dispositivo resuelto, sesión abierta y —si la mandó— su
   * instantánea guardada. Los tres pasos van juntos porque no existe un alta que resuelva el
   * dispositivo y no abra su sesión.
   */
  async openSessionForNewCustomer(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    input: StartOnboardingDto;
    ipAddress: string | null;
    now: Date;
    transaction: Transaction;
  }) {
    const { device, link } = await this.resolveDeviceAndLink(input);
    const session = await this.createOnboardingSession({ ...input, device, link });
    await this.captureDeviceSnapshotIfProvided({ ...input, device, session });
    return { device, session };
  }

  async resolveDeviceAndLink(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    input: StartOnboardingDto;
    now: Date;
    transaction: Transaction;
  }) {
    // 5. Resolve global device fingerprint
    let globalDevice = await this.sessionsRepository.findGlobalDevice(
      input.input.device.deviceFingerprintHash,
      input.input.device.fingerprintVersion,
      { transaction: input.transaction },
    );

    if (!globalDevice) {
      globalDevice = await this.sessionsRepository.createGlobalDevice(
        {
          deviceFingerprint: input.input.device.deviceFingerprintHash,
          fingerprintVersion: input.input.device.fingerprintVersion,
          now: input.now,
        },
        { transaction: input.transaction },
      );
    } else {
      await this.sessionsRepository.touchGlobalDevice(globalDevice, input.now, { transaction: input.transaction });
    }

    // 6. Resolve tenant-scoped device
    let device = await this.sessionsRepository.findDevice(
      input.tenantId,
      input.input.device.deviceFingerprintHash,
      input.input.device.fingerprintVersion,
      { transaction: input.transaction },
    );

    if (!device) {
      device = await this.sessionsRepository.createDevice(
        {
          tenantId: input.tenantId,
          globalDeviceFingerprintId: String(globalDevice.id),
          deviceFingerprint: input.input.device.deviceFingerprintHash,
          fingerprintVersion: input.input.device.fingerprintVersion,
          now: input.now,
        },
        { transaction: input.transaction },
      );
    } else {
      await this.sessionsRepository.touchDevice(device, input.now, { transaction: input.transaction });
    }

    // 7. Create customer-device link
    let link = await this.sessionsRepository.findCustomerDeviceLink(input.tenantId, String(input.customer.id), String(device.id), {
      transaction: input.transaction,
    });

    if (!link) {
      link = await this.sessionsRepository.createCustomerDeviceLink(
        { tenantId: input.tenantId, customerId: String(input.customer.id), deviceId: String(device.id), now: input.now },
        { transaction: input.transaction },
      );
    }

    return { device, link };
  }

  // 8. Create initial onboarding session
  async createOnboardingSession(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    device: Awaited<ReturnType<SessionsRepository['findDevice']>>;
    link: Awaited<ReturnType<SessionsRepository['findCustomerDeviceLink']>>;
    input: StartOnboardingDto;
    ipAddress: string | null;
    now: Date;
    transaction: Transaction;
  }) {
    const session = await this.sessionsRepository.createSession(
      {
        tenantId: input.tenantId,
        customerId: String(input.customer.id),
        deviceId: String(input.device!.id),
        sessionTokenHash: sha256Hex(randomUUID()),
        channel: input.input.device.channel,
        authMethod: 'onboarding',
        ipAddress: input.ipAddress,
        userAgent: input.input.device.userAgent ?? null,
        gpsLat: null,
        gpsLng: null,
        gpsAccuracyMeters: null,
        now: input.now,
      },
      { transaction: input.transaction },
    );

    await this.sessionsRepository.touchCustomerDeviceLink(input.link!, String(session.id), input.now, { transaction: input.transaction });

    return session;
  }

  // 9. Capture device snapshot if provided
  async captureDeviceSnapshotIfProvided(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    device: Awaited<ReturnType<SessionsRepository['findDevice']>>;
    session: Awaited<ReturnType<SessionsRepository['createSession']>>;
    input: StartOnboardingDto;
    now: Date;
    transaction: Transaction;
  }): Promise<void> {
    if (input.input.device.snapshot) {
      await this.sessionsRepository.createDeviceSnapshot(
        {
          tenantId: input.tenantId,
          customerId: String(input.customer.id),
          deviceId: String(input.device!.id),
          sessionId: String(input.session.id),
          brand: input.input.device.snapshot.brand ?? null,
          model: input.input.device.snapshot.model ?? null,
          osFamily: input.input.device.snapshot.osFamily ?? null,
          osVersion: input.input.device.snapshot.osVersion ?? null,
          appVersion: input.input.device.snapshot.appVersion ?? null,
          isRooted: input.input.device.snapshot.isRooted ?? null,
          isEmulator: input.input.device.snapshot.isEmulator ?? null,
          vpnDetected: input.input.device.snapshot.vpnDetected ?? null,
          now: input.now,
        },
        { transaction: input.transaction },
      );
    }
  }
}
