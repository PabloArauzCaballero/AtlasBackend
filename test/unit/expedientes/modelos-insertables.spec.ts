import { describe, expect, it } from '@jest/globals';
import { Sequelize } from 'sequelize-typescript';
import { ExpedienteModel } from '../../../src/database/models/expedientes.model.js';
import { ExpedienteNodoModel } from '../../../src/database/models/expediente-nodos.model.js';
import { ExpedienteConcesionModel } from '../../../src/database/models/expediente-concesiones.model.js';
import { ExpedienteActividadModel } from '../../../src/database/models/expediente-actividad.model.js';
import { ExpedienteTicketSubidaModel } from '../../../src/database/models/expediente-tickets-subida.model.js';

/**
 * ¿Sale la fila del proceso?
 *
 * Sequelize valida `allowNull` **antes** de enviar el INSERT: si el modelo declara una columna
 * obligatoria que el repositorio no rellena, la fila nunca llega a la base y el `DEFAULT` de la
 * tabla no se usa jamás. Es un fallo que ninguna prueba de servicio ve —los dobles de repositorio
 * devuelven lo que se les diga— y que en el despliegue se manifestó como «el cliente se creó y su
 * carpeta no», sin un solo error visible: los ganchos del expediente toleran fallos a propósito.
 *
 * Estas pruebas construyen cada modelo con EXACTAMENTE los valores que pasa
 * `ExpedientesRepository` y ejecutan la validación del ORM. No tocan la base: `Model.build(...)`
 * y `validate()` son locales, así que esto corre en CI sin PostgreSQL y aun así habría atajado los
 * dos fallos que costaron dos despliegues.
 */
const sequelize = new Sequelize({ dialect: 'postgres', logging: false });
sequelize.addModels([
  ExpedienteModel,
  ExpedienteNodoModel,
  ExpedienteConcesionModel,
  ExpedienteActividadModel,
  ExpedienteTicketSubidaModel,
]);

describe('modelos del expediente: la fila sale del proceso', () => {
  it('un expediente nuevo, con lo que pasa crearExpediente()', async () => {
    const fila = ExpedienteModel.build({
      tenantId: '1',
      subjectType: 'customer',
      subjectId: '20',
      sessionId: '55',
      customerCode: 'CUS-0001',
      creadoPorTipo: 'sistema',
      creadoPorId: null,
      estado: 'abierto',
    });
    await expect(fila.validate()).resolves.toBeDefined();
  });

  it('una CARPETA, con lo que pasa crearNodo() — sin booleanos explícitos', async () => {
    // Aquí es donde falló: `virtual`, `inmutable` y `objeto_ausente` tienen DEFAULT en la tabla y
    // el servicio no los envía, así que el modelo tiene que traer su propio valor por defecto.
    const fila = ExpedienteNodoModel.build({
      tenantId: '1',
      expedienteId: '1',
      parentId: null,
      tipo: 'carpeta',
      nombre: 'auth',
      ruta: '/auth',
      origen: 'sistema',
      creadoPorTipo: 'sistema',
      creadoPorId: null,
    });
    await expect(fila.validate()).resolves.toBeDefined();
  });

  it('un ARCHIVO de evidencia, con su clave de objeto', async () => {
    const fila = ExpedienteNodoModel.build({
      tenantId: '1',
      expedienteId: '1',
      parentId: '2',
      tipo: 'archivo',
      nombre: 'anverso.jpg',
      ruta: '/auth/anverso.jpg',
      origen: 'onboarding',
      clase: 'identidad',
      storageKey: '1/20/identity_front/abc.jpg',
      storageBucket: 'atlas-evidence',
      sha256: 'a'.repeat(64),
      mimeType: 'image/jpeg',
      sizeBytes: '30957',
      evidenceDocumentId: '9',
      creadoPorTipo: 'sistema',
      creadoPorId: null,
    });
    await expect(fila.validate()).resolves.toBeDefined();
  });

  it('el nodo VIRTUAL de contactos, que no tiene objeto', async () => {
    const fila = ExpedienteNodoModel.build({
      tenantId: '1',
      expedienteId: '1',
      parentId: null,
      tipo: 'archivo',
      nombre: 'contactos.json',
      ruta: '/contactos.json',
      origen: 'sistema',
      clase: 'contactos',
      virtual: true,
      creadoPorTipo: 'sistema',
      creadoPorId: null,
    });
    await expect(fila.validate()).resolves.toBeDefined();
  });

  it('una entrada de bitácora, con lo que pasa registrar()', async () => {
    const fila = ExpedienteActividadModel.build({
      tenantId: '1',
      expedienteId: '1',
      nodoId: null,
      accion: 'crear',
      actorTipo: 'sistema',
      actorId: null,
      detalle: {},
    });
    await expect(fila.validate()).resolves.toBeDefined();
  });

  it('una concesión, con lo que pasa crearConcesion()', async () => {
    const fila = ExpedienteConcesionModel.build({
      tenantId: '1',
      nodoId: '3',
      principalTipo: 'rol',
      principalId: 'FRAUD_ANALYST',
      nivel: 'leer',
      otorgadoPorId: '7',
      motivo: 'investigación de fraude abierta',
      venceEn: null,
    });
    await expect(fila.validate()).resolves.toBeDefined();
  });

  it('un ticket de subida, con lo que pasa crearTicket()', async () => {
    const fila = ExpedienteTicketSubidaModel.build({
      tenantId: '1',
      expedienteId: '1',
      parentId: null,
      nombrePrevisto: 'extracto.pdf',
      mimeType: 'application/pdf',
      sizeBytes: '104373',
      sha256Declarado: 'b'.repeat(64),
      storageKey: 'expedientes/1/1/abc.pdf',
      emitidoPorId: '7',
      venceEn: new Date(Date.now() + 600_000),
    });
    await expect(fila.validate()).resolves.toBeDefined();
  });
});
