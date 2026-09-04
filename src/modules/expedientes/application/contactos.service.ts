/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Reúne los contactos del cliente para quien revisa, sin sacarlos de la base.
 * @system compone contactos.json desde PostgreSQL en cada petición; nunca lo guarda como objeto.
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { decryptSecretEnvelope } from '../../../common/utils/crypto/envelope-encryption.util.js';
import {
  CustomerReferenceContactModel,
  OnDeviceComputationRunModel,
  OnDeviceMetricValueModel,
} from '../../../database/models/index.js';
import { CustomerContactsRepository } from '../../customers/repositories/customer-contacts.repository.js';
import { ExpedientesRepository } from '../repositories/expedientes.repository.js';
import type { ActorExpediente } from '../expedientes.types.js';

/**
 * Los contactos del expediente, servidos desde la BASE y no desde el almacén.
 *
 * ## Por qué no es un objeto en MinIO
 *
 * Porque los contactos ya viven en PostgreSQL, y algunos cifrados. Escribir un `contactos.json` en
 * el bucket habría creado una SEGUNDA copia de datos personales con menos controles que la tabla de
 * la que sale: el objeto se descarga entero, no distingue quién pregunta, y envejece — diría lo que
 * era cierto el día que se escribió, no lo que es cierto hoy. Componerlo en cada petición mantiene
 * una sola fuente de verdad y deja que el enmascarado dependa de quién mira.
 *
 * ## Qué agenda se enseña, y por qué en agregados
 *
 * Del alta móvil el servidor recibe CUENTAS y hashes de un solo uso que cruza y descarta, así que
 * de ese camino sólo quedan agregados (`on_device_computation_runs`) y eso es lo que se publica.
 *
 * Existe además una vía distinta —`customer.customer_device_contacts`, con consentimiento
 * `device_address_book` explícito— donde sí se guarda la ficha de cada contacto, cifrada. **No se
 * mezcla con esta lista**: una referencia declarada la eligió el cliente y tiene base de
 * consentimiento; un contacto de la agenda es un tercero que no consintió nada, y enseñarlos juntos
 * llevaría a tratarlos igual. Cuando esa sección se añada aquí, va etiquetada aparte y se lee por
 * el repositorio de ese módulo, nunca con SQL propio: lo que hay en claro son hashes, y el nombre
 * sale sólo por `decryptSecretEnvelope`.
 */
@Injectable()
export class ContactosService {
  constructor(
    private readonly contactos: CustomerContactsRepository,
    private readonly repository: ExpedientesRepository,
    @InjectModel(CustomerReferenceContactModel)
    private readonly referencias: typeof CustomerReferenceContactModel,
    @InjectModel(OnDeviceComputationRunModel)
    private readonly corridas: typeof OnDeviceComputationRunModel,
    @InjectModel(OnDeviceMetricValueModel)
    private readonly metricas: typeof OnDeviceMetricValueModel,
  ) {}

  /**
   * Los agregados de la agenda, tal como se guardaron.
   *
   * Se leen aquí y no por `CustomerContactsSnapshotService.featuresFor` a propósito, y no es
   * duplicación: aquél produce PROPORCIONES para el motor de riesgo —«qué parte de los teléfonos
   * son únicos»— y esto produce los RECUENTOS que una persona lee en una pantalla. Son dos formas
   * distintas del mismo dato para dos consumidores distintos, y acoplarlas habría metido al módulo
   * de expedientes dentro del de onboarding, que a su vez lo necesita para sus ganchos: una
   * dependencia circular entre módulos que Nest no resuelve sin `forwardRef`, prohibido en este
   * repositorio salvo justificación.
   */
  private async agendaDe(tenantId: string, customerId: string) {
    const corrida = await this.corridas.findOne({
      where: { tenantId, customerId },
      order: [['_id', 'DESC']],
    });
    if (!corrida) return { estado: 'sin_datos' as const, recuentos: {} as Record<string, number> };

    const filas = await this.metricas.findAll({ where: { tenantId, computationRunId: String(corrida.id) } });
    const recuentos: Record<string, number> = {};
    for (const fila of filas) {
      if (!fila.metricCode) continue;
      if (fila.valueNumber !== null && fila.valueNumber !== undefined) recuentos[fila.metricCode] = Number(fila.valueNumber);
    }
    return {
      // `skipped` significa que la persona se NEGÓ a compartir la agenda, y eso es una respuesta que
      // se registra: distinguirla de «no se preguntó» evita leer una negativa como una ausencia.
      estado: corrida.computationStatus ?? 'desconocido',
      fichasGuardadas: corrida.rawContactsStored ?? false,
      recuentos,
    };
  }

  /**
   * Enmascara dejando lo justo para reconocer sin identificar.
   *
   * Los últimos cuatro dígitos de un teléfono son lo que una persona usa para confirmar «sí, es
   * ese número» sin que el dato sirva para llamar. Es el mismo criterio que ya aplica el resumen de
   * investigación.
   */
  private enmascarar(tipo: string | null, last4: string | null, dominio: string | null): string | null {
    if (tipo === 'email') return dominio ? `•••@${dominio}` : null;
    return last4 ? `•••• ${last4}` : null;
  }

  async componer(input: {
    tenantId: string;
    expedienteId: string;
    customerId: string;
    actor: ActorExpediente;
    revelar: boolean;
    motivo?: string;
  }) {
    if (input.revelar) {
      /*
       * Revelar es una acción aparte, con su permiso y su motivo.
       *
       * Ver el teléfono completo de la referencia de un cliente no es un grado más de «leer el
       * expediente»: es acceder al dato de un TERCERO que no es cliente de Atlas y que dio su
       * número para que le llamaran una vez. Por eso exige permiso propio, motivo escrito, y queda
       * en la bitácora con nombre y hora.
       */
      if (!input.actor.permisos.includes('expedientes.pii.revelar')) {
        throw new ForbiddenException('EXPEDIENTE_REVELAR_NO_PERMITIDO');
      }
      if (!input.motivo || input.motivo.trim().length < 8) {
        throw new BadRequestException('EXPEDIENTE_MOTIVO_REQUERIDO');
      }
    }

    const metodos = await this.contactos.findContactMethods(input.tenantId, input.customerId);
    const referencias = await this.referencias.findAll({
      where: { tenantId: input.tenantId, customerId: input.customerId },
      order: [['_id', 'ASC']],
    });
    const agenda = await this.agendaDe(input.tenantId, input.customerId);

    if (input.revelar) {
      await this.repository.registrar({
        tenantId: input.tenantId,
        expedienteId: input.expedienteId,
        nodoId: null,
        accion: 'revelar_pii',
        actorTipo: input.actor.tipo,
        actorId: input.actor.id,
        detalle: { motivo: input.motivo?.trim(), customerId: input.customerId },
      });
    }

    return {
      version: 1,
      generadoEn: new Date().toISOString(),
      customerId: input.customerId,
      enmascarado: !input.revelar,
      /*
       * Sin revelar NO se descifra nada.
       *
       * El enmascarado sale de columnas que la fila ya guarda en claro para esto —`valueLast4`,
       * `emailDomain`— y no de recortar el valor descifrado. La diferencia importa: así el camino
       * normal de la pantalla nunca toca la clave de cifrado, y descifrar queda como una acción
       * excepcional que deja rastro.
       */
      metodosDeContacto: await Promise.all(
        metodos.map(async (metodo) => ({
          tipo: metodo.contactType,
          valor: input.revelar
            ? await decryptSecretEnvelope(metodo.contactValueEncrypted)
            : this.enmascarar(metodo.contactType, metodo.valueLast4, metodo.emailDomain),
          esPrincipal: metodo.isPrimary ?? false,
          estado: metodo.status,
          origen: metodo.sourceType,
          vistoPorPrimeraVez: metodo.firstSeenAt?.toISOString() ?? null,
        })),
      ),
      referencias: await Promise.all(
        referencias.map(async (referencia) => ({
          relacion: referencia.relationshipType,
          nombre: input.revelar ? await decryptSecretEnvelope(referencia.fullNameEncrypted) : null,
          telefono: input.revelar ? await decryptSecretEnvelope(referencia.phoneEncrypted) : null,
          telefonoUltimos4: referencia.phoneLast4,
          baseDeConsentimiento: referencia.consentBasis,
          contactabilidad: referencia.contactabilityStatus,
          verificacion: referencia.verificationStatus,
          notificada: referencia.referenceNotified ?? false,
          notificadaEn: referencia.referenceNotifiedAt?.toISOString() ?? null,
        })),
      ),
      agenda,
    };
  }
}
