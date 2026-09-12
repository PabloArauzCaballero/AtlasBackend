import { getStringFromPaths, request, uniqueKey } from './http.js';
import { qrPng } from '../fixtures/qr-imagen.js';

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
/*
 * Un QR DE VERDAD, y no el píxel transparente que había aquí.
 *
 * El registro del QR comprueba desde hace semanas que la imagen contenga un código legible
 * (`QR_IMAGE_HAS_NO_CODE`: «sube la imagen del código, no una foto del local»). Este smoke seguía
 * subiendo un PNG de 1×1, así que moría con un 422 ANTES de llegar al envío del expediente — es
 * decir, la mitad más importante del recorrido llevaba semanas sin ejercitarse y el fallo se leía
 * como un problema del almacenamiento.
 *
 * Se reutiliza el fixture de `test/support/qr-imagen.ts` a propósito: duplicarlo dejaría que el
 * smoke siguiera pasando con un QR que las pruebas ya no aceptan.
 */
const QR_PNG = qrPng();

/** Un PDF mínimo pero válido: el poder no se lee, sólo tiene que existir donde se dice que está. */
const PODER_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n' + 'trailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8',
);

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
  /*
   * El poder se SUBE de verdad antes de declararlo.
   *
   * El registro del representante comprueba que el objeto exista en el almacenamiento
   * (`POWER_OF_ATTORNEY_OBJECT_NOT_FOUND`), y aquí se inventaba una clave que no apuntaba a nada.
   * Un smoke que declara un poder inexistente no prueba la acreditación: prueba que el campo acepta
   * texto.
   */
  const poderKey = await subirPoder(partnerId);
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
      powerOfAttorneyKey: poderKey,
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
   * El envío NO decide por su cuenta: se lo pregunta al Motor, y aquí se comprueba que la respuesta
   * llegó y quedó registrada. Un expediente enviado sin ejecución detrás significa que el circuito
   * está roto en algún punto y el veredicto lo puso alguien de este lado.
   */
  const decision = (submittedBody.decision ?? {}) as JsonRecord;
  assert(
    typeof decision.executionId === 'string' && decision.executionId.length > 0,
    'tras enviar debe constar la ejecución del Motor que evaluó el expediente; no llegó ninguna',
  );
  assert(
    ['APROBADO', 'RECHAZADO', 'REVISION_MANUAL'].includes(String(decision.outcome)),
    `el desenlace del Motor no es uno de los tres del artefacto: ${String(decision.outcome)}`,
  );
  /*
   * Y el estado del expediente TIENE que corresponderse con ese desenlace. Es la afirmación que
   * impide que alguien vuelva a convertir esto en un formulario que se auto-aprueba: un
   * `approved` sólo es legítimo si el Motor dijo `APROBADO`.
   */
  const esperado: Record<string, string> = {
    APROBADO: 'approved',
    RECHAZADO: 'rejected',
    REVISION_MANUAL: 'under_review',
  };
  assert(
    submittedBody.onboardingStatus === esperado[String(decision.outcome)],
    `el expediente quedó en ${String(submittedBody.onboardingStatus)} con desenlace ${String(decision.outcome)}`,
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
  // --- 12. El contrato bajo el que se afilia -----------------------------------------------------
  await verificarContratoDeAfiliacion();

  console.log(`[partner-onboarding] expediente ${partnerId} completo y en revisión.`);
}

/**
 * El contrato de afiliación: publicar una versión, leer la vigente y comprobar que se archiva.
 *
 * Verificar que un comercio EXISTE no es tener algo firmado con él. Esta parte comprueba las tres
 * reglas que hacen del contrato una evidencia y no un campo de texto: la versión sube sola, la
 * anterior se archiva, y sólo hay UNA vigente.
 */
async function verificarContratoDeAfiliacion(): Promise<void> {
  const codigo = `SMOKE-${String(Date.now()).slice(-8)}`;
  const cuerpo =
    `PRIMERA. Objeto. Contrato de prueba del smoke, generado el ${new Date().toISOString()}. ` +
    'SEGUNDA. Comisión. La pactada por escrito entre las partes. TERCERA. Devoluciones. Revierten la comisión.';

  const primera = unwrap(
    (
      await request<JsonRecord>({
        method: 'POST',
        path: '/operations/partner-contract-templates',
        role: 'admin',
        expected: [201],
        body: { templateCode: codigo, name: 'Contrato de afiliación (smoke)', body: cuerpo, makeDefault: true },
      })
    ).data,
  );
  assert(primera.version === 1, `la primera versión de un código debe ser 1; llegó ${String(primera.version)}`);

  const segunda = unwrap(
    (
      await request<JsonRecord>({
        method: 'POST',
        path: '/operations/partner-contract-templates',
        role: 'admin',
        expected: [201],
        body: { templateCode: codigo, name: 'Contrato de afiliación (smoke)', body: `${cuerpo} CUARTA. Añadida.`, makeDefault: true },
      })
    ).data,
  );
  assert(segunda.version === 2, `publicar debe SUBIR la versión; llegó ${String(segunda.version)}`);

  const vigente = unwrap(
    (await request<JsonRecord>({ method: 'GET', path: '/operations/partner-contract-templates/default', role: 'admin' })).data,
  );
  const plantilla = (vigente.template ?? {}) as JsonRecord;
  assert(
    plantilla.version === 2 && plantilla.templateCode === codigo,
    `la vigente debe ser la última publicada; es ${String(plantilla.templateCode)} v${String(plantilla.version)}`,
  );

  /*
   * La anterior sigue ahí, archivada. Es la prueba de qué texto regía cada día, y ocultarla dejaría
   * sin respuesta posible la pregunta que llega con el primer reclamo.
   */
  const listado = unwrap(
    (await request<JsonRecord>({ method: 'GET', path: '/operations/partner-contract-templates', role: 'admin' })).data,
  );
  const mias = ((listado.items ?? []) as JsonRecord[]).filter((item) => item.templateCode === codigo);
  const archivadas = mias.filter((item) => item.status === 'archived');
  assert(mias.length === 2, `deben conservarse las dos versiones publicadas; hay ${mias.length}`);
  assert(archivadas.length === 1 && archivadas[0].version === 1, 'la versión anterior debe quedar archivada, no borrada');
}

/**
 * Sube un poder notarial y devuelve su clave de almacenamiento.
 *
 * Dos pasos, como en la app: se pide el ticket firmado y se sube el objeto contra él. Hacerlo de
 * verdad es lo que permite que el registro del representante compruebe que el documento existe.
 */
async function subirPoder(partnerId: string): Promise<string> {
  const ticket = await request<JsonRecord>({
    method: 'POST',
    path: `/partner-onboarding/${partnerId}/documents/upload-url`,
    role: 'merchant',
    expected: [201, 503],
    body: { documentKind: 'power-of-attorney', contentType: 'application/pdf', sizeBytes: PODER_PDF.byteLength },
  });
  if (ticket.status === 503) {
    throw new Error('El almacenamiento de objetos no está configurado: el poder no se puede subir y el expediente no podrá enviarse.');
  }
  const uploadUrl = getStringFromPaths(ticket.data, [['data', 'uploadUrl'], ['uploadUrl']]);
  const storageKey = getStringFromPaths(ticket.data, [['data', 'storageKey'], ['storageKey']]);
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf', 'content-length': String(PODER_PDF.byteLength) },
    body: PODER_PDF,
  });
  if (!put.ok) throw new Error(`El almacenamiento rechazó el poder (${put.status}).`);
  return storageKey;
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
