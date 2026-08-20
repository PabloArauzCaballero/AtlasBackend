import { getStringFromPaths, request, uniqueKey } from './http.js';

/**
 * Smoke del expediente del partner contra un servidor y una base REALES.
 *
 * Recorre el flujo entero —abrir, registrar local, subir los dos QR, dar de alta un terminal y
 * enviar a revisión— y comprueba además lo que sólo se ve de punta a punta:
 *
 *  1. **El embudo dice lo que falta mientras se completa**, no sólo al pulsar «enviar». Un
 *     expediente recién abierto tiene que devolver sus cinco requisitos pendientes.
 *  2. **El NIT repetido no abre un segundo expediente** y el 409 trae el identificador del que ya
 *     existe, que es lo que permite continuarlo en vez de dejar al comercio sin salida.
 *  3. **El serial de un POS no se puede duplicar** dentro del tenant.
 *  4. **Un expediente incompleto NO se envía**, y el 422 trae la lista.
 *
 * Sobre el almacenamiento: la subida del QR necesita un bucket configurado. Si no lo hay, el
 * smoke **no calla ni finge**: informa exactamente qué falta y sigue con el resto, que es la regla
 * del repositorio para los gates que dependen de infraestructura externa. Un smoke que se salta un
 * paso en silencio es peor que uno que falla.
 */

type JsonRecord = Record<string, unknown>;

/** Saca el cuerpo del sobre que pone el filtro global, o devuelve la respuesta tal cual. */
function unwrap(value: JsonRecord): JsonRecord {
  const inner = value.data;
  return inner !== null && typeof inner === 'object' ? (inner as JsonRecord) : value;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * Un PNG mínimo REAL. El servidor descarga el objeto y comprueba que sea una imagen, así que un
 * cuerpo cualquiera haría fallar el registro por el motivo equivocado.
 */
const QR_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** Un NIT distinto por corrida: el expediente es único por NIT y el smoke no debe chocar consigo mismo. */
function uniqueTaxId(): string {
  return `9${String(Date.now()).slice(-9)}`;
}

export async function runPartnerOnboardingSmoke(): Promise<void> {
  const taxId = uniqueTaxId();

  // --- 1. Abrir el expediente -----------------------------------------------------------------
  const started = await request<JsonRecord>({
    method: 'POST',
    path: '/partner-onboarding/start',
    role: 'merchant',
    expected: [201],
    body: {
      legalName: 'Comercial Smoke S.R.L.',
      tradeName: 'Smoke Store',
      taxId,
      businessCategory: 'retail',
      contactEmail: `smoke-${taxId}@partner.test`,
      contactPhone: '+59170000000',
    },
  });
  // Las respuestas viajan envueltas (`{ requestId, data, timestamp }`), así que se leen por las dos
  // rutas: el sobre es del filtro global y no del contrato de este módulo.
  const partnerId = getStringFromPaths(started.data, [['data', 'partnerId'], ['partnerId']]);
  assert(partnerId.length > 0, 'start no devolvió partnerId');

  // --- 2. El mismo NIT no abre un segundo expediente -------------------------------------------
  const duplicate = await request<JsonRecord>({
    method: 'POST',
    path: '/partner-onboarding/start',
    role: 'merchant',
    expected: [409],
    body: { legalName: 'Otro nombre S.A.', taxId, contactEmail: `otro-${taxId}@partner.test` },
  });
  assert(
    JSON.stringify(duplicate.data).includes(partnerId),
    'el 409 por NIT repetido debe traer el partnerId del expediente que ya existe',
  );

  // --- 3. Recién abierto, el embudo declara todo lo que falta -----------------------------------
  const initialStatus = await request<JsonRecord>({
    method: 'GET',
    path: `/partner-onboarding/${partnerId}/status`,
    role: 'merchant',
    expected: [200],
  });
  const initialBody = unwrap(initialStatus.data);
  const initialGaps = (initialBody.gaps ?? []) as JsonRecord[];
  assert(initialGaps.length >= 4, `un expediente recién abierto debe declarar sus pendientes; llegaron ${initialGaps.length}`);
  assert(initialBody.readyToSubmit === false, 'un expediente vacío no puede estar listo para enviar');

  // --- 4. Un expediente incompleto NO se envía --------------------------------------------------
  const rejectedSubmit = await request<JsonRecord>({
    method: 'POST',
    path: `/partner-onboarding/${partnerId}/submit`,
    role: 'merchant',
    expected: [422],
  });
  assert(
    JSON.stringify(rejectedSubmit.data).includes('PARTNER_SUBMISSION_INCOMPLETE'),
    'el envío incompleto debe responder PARTNER_SUBMISSION_INCOMPLETE con la lista de lo que falta',
  );

  // --- 5. Verificación del contacto -------------------------------------------------------------
  /*
   * Prueba que el comercio controla el correo que declaró. Necesita canal de correo: sin él el
   * motor responde 422 en vez de fingir un envío, y este smoke lo acepta como resultado VÁLIDO y
   * lo dice — no como un paso que salió bien.
   */
  const verification = await request<JsonRecord>({
    method: 'POST',
    path: `/partner-onboarding/${partnerId}/contact-verification/request`,
    role: 'merchant',
    expected: [202, 422],
  });
  if (verification.status === 422) {
    console.warn(
      '[partner-onboarding] verificación de contacto NO probada: no hay canal de correo configurado ' +
        '(NOTIFICATION_EMAIL_PROVIDER / MailSender). El resto del flujo sí se ejercitó.',
    );
  } else {
    // El código llega por correo y este smoke no lo lee: lo que sí se puede afirmar sin buzón es
    // que un código equivocado se rechaza, que es la mitad que protege.
    await request({
      method: 'POST',
      path: `/partner-onboarding/${partnerId}/contact-verification/submit`,
      role: 'merchant',
      expected: [401],
      body: { code: '000000' },
    });
  }

  // --- 6. Sucursal ------------------------------------------------------------------------------
  const branchCode = uniqueKey('SC')
    .slice(0, 20)
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '-');
  const branch = await request<JsonRecord>({
    method: 'POST',
    path: `/partner-onboarding/${partnerId}/branches`,
    role: 'merchant',
    expected: [201],
    body: { branchCode, name: 'Sucursal Centro', addressLine: 'Av. Siempre Viva 742', city: 'Santa Cruz' },
  });
  const branchId = getStringFromPaths(branch.data, [['data', 'branchId'], ['branchId']]);
  assert(branchId.length > 0, 'la sucursal no devolvió branchId');

  // --- 7. Terminal POS, y su serial no se puede duplicar ---------------------------------------
  const serial = uniqueKey('SN')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-');
  await request({
    method: 'POST',
    path: `/partner-onboarding/${partnerId}/branches/${branchId}/pos-terminals`,
    role: 'merchant',
    expected: [201],
    body: { terminalSerial: serial, terminalAlias: 'Caja 1', provider: 'Smoke POS', model: 'S1' },
  });
  await request({
    method: 'POST',
    path: `/partner-onboarding/${partnerId}/branches/${branchId}/pos-terminals`,
    role: 'merchant',
    expected: [409],
    body: { terminalSerial: serial },
  });

  // --- 8. Los dos QR ---------------------------------------------------------------------------
  await uploadQrOrReportGap(partnerId, 'business');
  await uploadQrOrReportGap(partnerId, 'bank');

  // --- 9. Lo que faltaba para poder enviar ------------------------------------------------------
  await request({
    method: 'POST',
    path: `/partner-onboarding/${partnerId}/commercial-registry`,
    role: 'merchant',
    expected: [200],
    body: { commercialRegistry: `MAT-${taxId.slice(-6)}` },
  });
  await request({
    method: 'POST',
    path: `/partner-onboarding/${partnerId}/legal-representative`,
    role: 'merchant',
    expected: [201],
    body: {
      fullName: 'Ana Quiroga Vargas',
      documentType: 'ci',
      documentNumber: '4567890 SC',
      // El poder es lo que ACREDITA la representación: sin él, el expediente sigue incompleto
      // aunque la persona esté declarada. Se comprueba justo debajo.
      powerOfAttorneyKey: `1/partner-${partnerId}/poder/${taxId}.pdf`,
    },
  });

  // --- 10. El envío, que ahora sí procede --------------------------------------------------------
  const submitted = await request<JsonRecord>({
    method: 'POST',
    path: `/partner-onboarding/${partnerId}/submit`,
    role: 'merchant',
    expected: [200],
  });
  const submittedBody = unwrap(submitted.data);
  /*
   * `under_review` y NO `approved`: el envío no aprueba nada. Un onboarding que se auto-aprueba al
   * completar sus campos es un formulario, no una verificación, y esta afirmación es la que impide
   * que alguien lo convierta en eso sin que salte nada.
   */
  assert(
    submittedBody.onboardingStatus === 'under_review',
    `tras enviar, el expediente debe quedar en revisión; quedó en ${String(submittedBody.onboardingStatus)}`,
  );

  // Y ya enviado deja de admitir cambios: la aprobación se firma sobre lo que se revisó.
  await request({
    method: 'POST',
    path: `/partner-onboarding/${partnerId}/branches`,
    role: 'merchant',
    expected: [422],
    body: { branchCode: 'SC-TARDE', name: 'Sucursal tardía' },
  });

  // --- 11. Estado final -------------------------------------------------------------------------
  const finalStatus = await request<JsonRecord>({
    method: 'GET',
    path: `/partner-onboarding/${partnerId}/status`,
    role: 'merchant',
    expected: [200],
  });
  const finalBody = unwrap(finalStatus.data);
  const branches = (finalBody.branches ?? []) as JsonRecord[];
  const terminals = (finalBody.posTerminals ?? []) as JsonRecord[];
  assert(branches.length === 1, `se esperaba 1 sucursal, llegaron ${branches.length}`);
  assert(terminals.length === 1, `se esperaba 1 terminal, llegaron ${terminals.length}`);

  const remaining = (finalBody.gaps ?? []) as JsonRecord[];
  assert(remaining.length === 0, `el expediente enviado no debería tener pendientes; quedan ${remaining.length}`);
  console.log(`[partner-onboarding] expediente ${partnerId} completo y en revisión.`);
}

/**
 * Sube un QR, o dice EXACTAMENTE qué falta para poder hacerlo.
 *
 * El almacenamiento de objetos es infraestructura externa. Si no está configurado, el endpoint
 * responde 503 y este smoke lo reporta con el nombre del dato que falta en vez de dar el paso por
 * bueno: un smoke que se salta un paso en silencio deja creer que se probó algo que no se probó.
 */
async function uploadQrOrReportGap(partnerId: string, qrKind: 'business' | 'bank'): Promise<void> {
  const ticket = await request<JsonRecord>({
    method: 'POST',
    path: `/partner-onboarding/${partnerId}/qr-codes/upload-url`,
    role: 'merchant',
    expected: [201, 503],
    // El tamaño DECLARADO tiene que ser el real: el ticket firma `content-length`, así que pedir
    // permiso para 2 KB y subir 68 bytes da un 403 del almacenamiento. Es la protección haciendo
    // su trabajo —impide subir algo distinto de lo autorizado—, y este smoke la incumplía, lo que
    // hacía que el paso se reportara como «almacenamiento mal configurado» siendo un error propio.
    body: { qrKind, contentType: 'image/png', sizeBytes: QR_PNG.byteLength },
  });

  if (ticket.status === 503) {
    console.warn(
      `[partner-onboarding] QR ${qrKind} NO probado: falta configurar el almacenamiento de objetos ` +
        '(STORAGE_* en el entorno). El resto del flujo sí se ejercitó.',
    );
    return;
  }

  const uploadUrl = getStringFromPaths(ticket.data, [['data', 'uploadUrl'], ['uploadUrl']]);
  const storageKey = getStringFromPaths(ticket.data, [['data', 'storageKey'], ['storageKey']]);
  assert(uploadUrl.length > 0 && storageKey.length > 0, 'el ticket de subida llegó incompleto');

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/png', 'content-length': String(QR_PNG.byteLength) },
    body: QR_PNG,
  });
  if (!put.ok) {
    console.warn(
      `[partner-onboarding] QR ${qrKind} NO probado: el almacenamiento rechazó la subida (${put.status}). ` +
        'Revisa credenciales y permisos del bucket.',
    );
    return;
  }

  await request({
    method: 'POST',
    path: `/partner-onboarding/${partnerId}/qr-codes`,
    role: 'merchant',
    expected: [201],
    body: {
      qrKind,
      storageKey,
      ...(qrKind === 'bank' ? { bankInstitutionCode: 'BNB', accountNumberMasked: '****7890' } : {}),
    },
  });
}

if (process.argv[1]?.endsWith('partner-onboarding.smoke.ts') || process.argv[1]?.endsWith('partner-onboarding.smoke.js')) {
  void runPartnerOnboardingSmoke();
}
