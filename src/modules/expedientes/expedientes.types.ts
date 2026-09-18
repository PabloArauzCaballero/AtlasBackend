/**
 * @file Tipos de dominio: hacen explícitos estados y contratos internos.
 * @business El expediente reúne los archivos de una persona con quién puede verlos y qué había al decidir.
 * @system declara los tipos compartidos del módulo, sin depender de Sequelize ni de HTTP.
 */

/**
 * Los cuatro niveles, en orden creciente.
 *
 * Se comparan por su POSICIÓN en este arreglo y no por nombre: es lo que permite escribir
 * `alcanza(nivel, 'escribir')` una vez, en lugar de repartir por el módulo listas de «qué incluye
 * qué» que acaban divergiendo. Un nivel incluye siempre a los anteriores.
 */
export const NIVELES = ['leer', 'escribir', 'compartir', 'administrar'] as const;
export type Nivel = (typeof NIVELES)[number];

export function alcanza(actual: Nivel | null, requerido: Nivel): boolean {
  if (!actual) return false;
  return NIVELES.indexOf(actual) >= NIVELES.indexOf(requerido);
}

/** El mayor de dos niveles. `null` es «ninguno», no un nivel más bajo. */
export function nivelMayor(a: Nivel | null, b: Nivel | null): Nivel | null {
  if (!a) return b;
  if (!b) return a;
  return NIVELES.indexOf(a) >= NIVELES.indexOf(b) ? a : b;
}

export type EstadoExpediente = 'abierto' | 'enviado' | 'cerrado' | 'purgado';
export type TipoNodo = 'carpeta' | 'archivo';
export type OrigenNodo = 'onboarding' | 'motor' | 'portal' | 'sistema';

/**
 * De qué es cada archivo. Es lo que decide su icono, su carpeta y si se puede borrar.
 *
 * `otro` existe para lo que sube un operador a mano: no todo archivo tiene un papel en el flujo,
 * y forzar uno inventaría una categoría que después nadie sabe leer.
 */
export type ClaseNodo =
  | 'identity_front'
  | 'identity_back'
  | 'selfie'
  | 'bank_statement'
  | 'proof_of_address'
  | 'payment_proof'
  | 'partner_qr_bank'
  | 'partner_qr_business'
  | 'partner_document'
  | 'contactos'
  | 'consentimientos'
  | 'manifest'
  | 'verificacion'
  | 'analisis'
  | 'otro';

/** Las acciones que quedan en la bitácora. Códigos estables: se filtran desde la pantalla. */
export type AccionActividad =
  | 'crear'
  | 'ver'
  | 'descargar'
  | 'subir'
  | 'renombrar'
  | 'mover'
  | 'borrar'
  | 'restaurar'
  | 'purgar'
  | 'compartir'
  | 'revocar'
  | 'revelar_pii'
  | 'congelar';

export type SujetoExpediente = 'customer' | 'partner' | 'claim';

/** Carpetas que todo expediente de onboarding tiene desde el minuto uno. */
export const CARPETAS_BASE = [
  { nombre: 'auth', etiqueta: 'Identidad (auth)' },
  { nombre: 'extractos', etiqueta: 'Extractos bancarios' },
  { nombre: 'domicilio', etiqueta: 'Domicilio' },
  { nombre: 'otros', etiqueta: 'Otros' },
] as const;

/**
 * Las carpetas del expediente de un COMERCIO.
 *
 * No son las de la persona: un negocio no tiene selfie ni extracto que revisar, y enseñarle a un
 * operador una carpeta «Identidad (auth)» vacía en la ficha de una tienda diría que falta algo que
 * nunca se pidió. Lo que un comercio sube son sus QR de cobro (`partner_qr_codes`) y los
 * documentos que lo acreditan —el poder notarial, lo que el ERP guarda como KYB de su cuenta—.
 */
export const CARPETAS_BASE_PARTNER = [
  { nombre: 'qr', etiqueta: 'QR de cobro' },
  { nombre: 'documentos', etiqueta: 'Documentos del comercio' },
  { nombre: 'otros', etiqueta: 'Otros' },
] as const;

/** Las carpetas con las que nace un expediente según de quién sea. */
export function carpetasBaseDe(subjectType: SujetoExpediente): ReadonlyArray<{ nombre: string; etiqueta: string }> {
  return subjectType === 'partner' ? CARPETAS_BASE_PARTNER : CARPETAS_BASE;
}

/**
 * Dónde cae cada tipo de documento de evidencia.
 *
 * El mapa es explícito y no un `switch` disperso porque lo consultan tres sitios —el gancho del
 * onboarding, el backfill y la pantalla— y basta con que dos discrepen para que un extracto acabe
 * en «otros» según por dónde entrara.
 */
export const CARPETA_POR_TIPO: Readonly<Record<string, { carpeta: string; clase: ClaseNodo; nombre: string }>> = {
  identity_front: { carpeta: 'auth', clase: 'identity_front', nombre: 'anverso' },
  identity_back: { carpeta: 'auth', clase: 'identity_back', nombre: 'reverso' },
  selfie: { carpeta: 'auth', clase: 'selfie', nombre: 'selfie' },
  bank_statement: { carpeta: 'extractos', clase: 'bank_statement', nombre: 'extracto' },
  proof_of_address: { carpeta: 'domicilio', clase: 'proof_of_address', nombre: 'comprobante' },
  payment_proof: { carpeta: 'pagos', clase: 'payment_proof', nombre: 'comprobante de pago' },
  // Lo que sube un comercio. Los dos QR se distinguen por clase porque no son intercambiables: el
  // bancario dice a qué cuenta va el dinero; el del negocio es el cartel de la tienda.
  partner_qr_bank: { carpeta: 'qr', clase: 'partner_qr_bank', nombre: 'qr bancario' },
  partner_qr_business: { carpeta: 'qr', clase: 'partner_qr_business', nombre: 'qr del negocio' },
  partner_power_of_attorney: { carpeta: 'documentos', clase: 'partner_document', nombre: 'poder notarial' },
  partner_document: { carpeta: 'documentos', clase: 'partner_document', nombre: 'documento' },
  other: { carpeta: 'otros', clase: 'otro', nombre: 'documento' },
};

export type ActorExpediente = {
  tipo: 'internal_user' | 'system' | 'customer';
  id: string | null;
  /** Roles internos del actor, para resolver concesiones por rol. */
  roles: readonly string[];
  /** Permisos del catálogo RBAC, para el nivel base. */
  permisos: readonly string[];
};
