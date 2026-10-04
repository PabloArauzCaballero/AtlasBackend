/**
 * @file Utilidad pura: traduce una solicitud del titular y sus hechos a las variables del Motor.
 * @business El Motor decide con hechos de la cuenta (deuda, señales de robo, procesos abiertos), nunca con datos personales.
 * @system mapea filas ya leídas a las 17 entradas del artefacto PRIVACIDAD_SOLICITUD_TITULAR.
 */

/** El vocabulario del Motor para el dato a corregir (`scripts/lib/privacidad-solicitud-titular.definicion.json`). */
export const CAMPO_DEL_MOTOR: Record<string, string> = {
  address: 'DIRECCION',
  zone: 'ZONA',
  city: 'CIUDAD',
  address_reference: 'REFERENCIA_DOMICILIO',
  occupation: 'OCUPACION',
  employer: 'EMPLEADOR',
  declared_income: 'INGRESO_DECLARADO',
  first_name: 'NOMBRE',
  last_name: 'APELLIDO',
  birth_date: 'FECHA_NACIMIENTO',
  document_number: 'NUMERO_DOCUMENTO',
  phone: 'TELEFONO',
  email: 'CORREO',
  other: 'OTRO',
};

/** Los tipos de solicitud que el Motor decide. Las históricas (acceso, portabilidad…) siguen siendo de una persona. */
export const TIPO_DEL_MOTOR: Record<string, 'RECTIFICACION' | 'BORRADO'> = {
  rectification: 'RECTIFICACION',
  deletion: 'BORRADO',
};

/**
 * Estados de la cuenta en los que una solicitud se puede decidir sin mirar el expediente: activa o todavía en alta.
 * Observada, suspendida, rechazada, bloqueada o cerrada ya tienen a alguien mirando: otra decisión automática encima
 * pisaría la suya.
 */
export const ESTADOS_OPERATIVOS = ['registered', 'onboarding_in_progress', 'under_review', 'active'];

/** Lo que la base sabe de la cuenta, ya contado. Lo lee `PrivacyRequestFeaturesService`. */
export type HechosDeLaCuenta = {
  lifecycleStatus: string | null;
  identidadVerificada: boolean;
  contactoCambiado7d: boolean;
  dispositivoNuevo7d: boolean;
  fraudeAbierto: boolean;
  casoAbierto: boolean;
  solicitudesIgualesAbiertas: number;
  saldoPendiente: number;
  prestamosActivos: number;
  cuotasEnMora: number;
  pagosEnConciliacion: number;
  tuvoCredito: boolean;
  extractoEnRevision: boolean;
  cambiosDelCampo365d: number;
};

export type SolicitudADecidir = {
  requestType: string | null;
  rectificationField: string | null;
  pinVerifiedAt: Date | null;
};

/** ¿La decide el Motor? Sólo corregir y borrar; el resto, siempre una persona. */
export function esDecidiblePorElMotor(requestType: string | null): boolean {
  return requestType !== null && requestType in TIPO_DEL_MOTOR;
}

/**
 * Las 17 entradas del artefacto.
 *
 * Una corrección sin campo (la mandan versiones viejas de la app, sólo con texto) viaja como `OTRO`: el Motor la manda a
 * una persona, que es lo correcto porque nadie sabe qué hay que corregir. Un borrado viaja con `NINGUNO`.
 */
export function variablesDeLaSolicitud(solicitud: SolicitudADecidir, hechos: HechosDeLaCuenta): Record<string, string | number | boolean> {
  const tipo = TIPO_DEL_MOTOR[solicitud.requestType ?? ''];
  if (!tipo) throw new Error(`El Motor no decide solicitudes de tipo ${solicitud.requestType ?? 'vacío'}.`);
  const campo = tipo === 'BORRADO' ? 'NINGUNO' : (CAMPO_DEL_MOTOR[solicitud.rectificationField ?? ''] ?? 'OTRO');
  return {
    dsr_tipo: tipo,
    dsr_cuenta_operativa: ESTADOS_OPERATIVOS.includes(hechos.lifecycleStatus ?? ''),
    dsr_identidad_verificada: hechos.identidadVerificada,
    dsr_pin_confirmado: solicitud.pinVerifiedAt !== null,
    dsr_contacto_cambiado_7d: hechos.contactoCambiado7d,
    dsr_dispositivo_nuevo_7d: hechos.dispositivoNuevo7d,
    dsr_fraude_abierto: hechos.fraudeAbierto,
    dsr_caso_abierto: hechos.casoAbierto,
    dsr_solicitudes_iguales_abiertas: hechos.solicitudesIgualesAbiertas,
    // Redondeado a céntimos: el Motor lo valida como importe y un 0.30000000000000004 no es un saldo.
    dsr_saldo_pendiente: Math.round(Math.max(0, hechos.saldoPendiente) * 100) / 100,
    dsr_prestamos_activos: hechos.prestamosActivos,
    dsr_cuotas_en_mora: hechos.cuotasEnMora,
    dsr_pagos_en_conciliacion: hechos.pagosEnConciliacion,
    dsr_tuvo_credito: hechos.tuvoCredito,
    dsr_extracto_en_revision: hechos.extractoEnRevision,
    dsr_campo: campo,
    dsr_cambios_del_campo_365d: tipo === 'BORRADO' ? 0 : hechos.cambiosDelCampo365d,
  };
}
