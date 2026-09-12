import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * La regla de privacidad de `on_device_computation_runs`, comprobada sobre la expresión del CHECK.
 *
 * Se prueba aquí y no contra PostgreSQL porque lo que puede romperse no es que la base aplique un
 * CHECK —eso lo hace siempre— sino que alguien cambie la EXPRESIÓN y afloje la garantía sin
 * darse cuenta. La expresión es una fórmula booleana pequeña: se extrae del archivo de migración y
 * se evalúa con los tres algoritmos que existen.
 *
 * El fallo que esto evita ya ocurrió una vez al revés: el CHECK de junio prohibía guardar fichas, la
 * sincronización de agenda de septiembre las guarda a propósito, y nadie los reconcilió —así que
 * `POST /customers/:id/address-book` devolvía 500 en producción—.
 */

const MIGRACION = resolve(process.cwd(), 'src/database/migrations/20260910100000-fix-on-device-raw-contacts-check.ts');

/**
 * Evalúa la expresión del CHECK con la LÓGICA DE TRES VALORES de SQL, no con la de JavaScript.
 *
 * La diferencia no es académica: un CHECK de PostgreSQL acepta la fila cuando la expresión da TRUE
 * **o NULL**, y un `=` contra un nulo da NULL, no FALSE. La primera versión de esta migración usaba
 * `algorithm_code = '...'` y por eso una fila con `raw_contacts_stored = true` y sin algoritmo
 * declarado ENTRABA —justo lo que la restricción existe para impedir—. Lo cazó ejecutar la
 * migración contra un PostgreSQL real; este modelo, escrito con `===`, la daba por rechazada.
 *
 * Por eso el CHECK usa `IS NOT DISTINCT FROM`, que trata el nulo como un valor más y devuelve FALSE
 * en vez de NULL. Y por eso este ayudante devuelve `null` donde SQL diría «desconocido», y `pasa()`
 * aplica la regla real: pasa si es TRUE o si es NULL.
 */
type Tri = boolean | null;

const y = (a: Tri, b: Tri): Tri => (a === false || b === false ? false : a === null || b === null ? null : true);
const o = (a: Tri, b: Tri): Tri => (a === true || b === true ? true : a === null || b === null ? null : false);

function evaluarCheck(fila: { rawContactsStored: boolean | null; rawSmsStored: boolean | null; algorithmCode: string | null }): Tri {
  const smsNo: Tri = fila.rawSmsStored === false;
  const contactosNo: Tri = fila.rawContactsStored === false;
  // `IS NOT DISTINCT FROM`: nunca devuelve desconocido, ni siquiera contra un nulo.
  const autorizado: Tri = fila.algorithmCode === 'CONTACTS_ADDRESS_BOOK_SYNC';
  const contactosSiPeroAutorizado = y(fila.rawContactsStored === true, autorizado);
  return y(smsNo, o(contactosNo, contactosSiPeroAutorizado));
}

/** PostgreSQL acepta la fila si el CHECK da TRUE **o** desconocido. */
function cumpleElCheck(fila: { rawContactsStored: boolean | null; rawSmsStored: boolean | null; algorithmCode: string | null }): boolean {
  return evaluarCheck(fila) !== false;
}

describe('el CHECK que declara la migración', () => {
  const sql = readFileSync(MIGRACION, 'utf8');

  /*
   * Si alguien reescribe la expresión, esta comprobación falla y obliga a revisar también las
   * reglas de abajo. Sin ella, el spec podría seguir en verde describiendo un CHECK que ya no
   * existe.
   */
  it('sigue siendo la fórmula que estas reglas describen', () => {
    const expresion = sql.slice(sql.indexOf('ADD CONSTRAINT ${NUEVO} CHECK ('), sql.indexOf('`);', sql.indexOf('ADD CONSTRAINT ${NUEVO}')));
    const normalizada = expresion.replace(/\s+/g, ' ');

    expect(normalizada).toContain('raw_sms_stored IS FALSE');
    // `IS NOT DISTINCT FROM` y no `=`: con `=`, un algoritmo nulo deja el CHECK en desconocido y
    // PostgreSQL acepta la fila. Ver el comentario de la migración.
    expect(normalizada).toContain("algorithm_code IS NOT DISTINCT FROM 'CONTACTS_ADDRESS_BOOK_SYNC'");
  });

  it('la reversión restaura el CHECK original, sin dejarlo más laxo', () => {
    expect(sql).toContain('CHECK (raw_contacts_stored IS FALSE AND raw_sms_stored IS FALSE)');
  });
});

describe('lo que la regla permite y lo que no', () => {
  /* Lo absoluto: ningún camino guarda SMS, y ninguno debe poder empezar a hacerlo. */
  it('rechaza guardar SMS venga del algoritmo que venga', () => {
    for (const algorithmCode of ['CONTACTS_ADDRESS_BOOK_SYNC', 'CONTACTS_ADDRESS_BOOK_SNAPSHOT', 'atlas_on_device_metrics']) {
      expect(cumpleElCheck({ rawContactsStored: false, rawSmsStored: true, algorithmCode })).toBe(false);
    }
  });

  /* El camino que el cliente autoriza expresamente, y cuyas fichas viven atadas a un consentimiento. */
  it('deja a la sincronización completa declarar que guardó fichas', () => {
    expect(cumpleElCheck({ rawContactsStored: true, rawSmsStored: false, algorithmCode: 'CONTACTS_ADDRESS_BOOK_SYNC' })).toBe(true);
  });

  /* El resumen agregado publica cuentas y proporciones: si un día intentara guardar fichas, es un bug. */
  it('sigue prohibiendo que el resumen agregado guarde fichas', () => {
    expect(cumpleElCheck({ rawContactsStored: true, rawSmsStored: false, algorithmCode: 'CONTACTS_ADDRESS_BOOK_SNAPSHOT' })).toBe(false);
    expect(cumpleElCheck({ rawContactsStored: true, rawSmsStored: false, algorithmCode: 'atlas_on_device_metrics' })).toBe(false);
  });

  it('acepta los tres caminos cuando no guardan nada', () => {
    for (const algorithmCode of ['CONTACTS_ADDRESS_BOOK_SYNC', 'CONTACTS_ADDRESS_BOOK_SNAPSHOT', 'atlas_on_device_metrics']) {
      expect(cumpleElCheck({ rawContactsStored: false, rawSmsStored: false, algorithmCode })).toBe(true);
    }
  });

  /*
   * Si no consta QUÉ se ejecutó, no consta que hubiera permiso para guardar nada: el caso ambiguo
   * cae del lado restrictivo. Un nulo en cualquiera de las dos banderas tampoco pasa —`NULL IS
   * FALSE` es falso en SQL—, que es lo que hace que una fila a medias no cuele.
   */
  it('cae del lado restrictivo cuando el algoritmo o las banderas no constan', () => {
    // Comprobado también contra un PostgreSQL real: los cuatro se rechazan.
    expect(cumpleElCheck({ rawContactsStored: true, rawSmsStored: false, algorithmCode: null })).toBe(false);
    expect(cumpleElCheck({ rawContactsStored: true, rawSmsStored: false, algorithmCode: 'ALGO_NUEVO' })).toBe(false);
    expect(cumpleElCheck({ rawContactsStored: null, rawSmsStored: false, algorithmCode: 'CONTACTS_ADDRESS_BOOK_SYNC' })).toBe(false);
    expect(cumpleElCheck({ rawContactsStored: false, rawSmsStored: null, algorithmCode: 'CONTACTS_ADDRESS_BOOK_SYNC' })).toBe(false);
  });
});

describe('lo que el código escribe encaja con la regla', () => {
  /*
   * Los tres sitios que insertan en la tabla, comprobados contra el CHECK. Es la mitad que faltaba
   * la vez anterior: la regla y el código vivían en archivos distintos y nadie los cruzó.
   */
  const escrituras = [
    {
      fuente: 'customer-device-contacts.repository.ts',
      algorithmCode: 'CONTACTS_ADDRESS_BOOK_SYNC',
      rawContactsStored: true,
      rawSmsStored: false,
    },
    {
      fuente: 'customer-contacts-snapshot.repository.ts',
      algorithmCode: 'CONTACTS_ADDRESS_BOOK_SNAPSHOT',
      rawContactsStored: false,
      rawSmsStored: false,
    },
    {
      fuente: 'telemetry-on-device.repository.ts',
      algorithmCode: 'atlas_on_device_metrics',
      rawContactsStored: false,
      rawSmsStored: false,
    },
  ];

  it.each(escrituras)('$fuente escribe una fila que el CHECK acepta', (escritura) => {
    expect(cumpleElCheck(escritura)).toBe(true);
  });
});
