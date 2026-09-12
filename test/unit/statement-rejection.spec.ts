/**
 * Lo que se le dice a quien subió un extracto que no sirve.
 *
 * Es la mitad del arreglo y la que se olvida: el motor ya sabía distinguir los casos, y la app decía
 * la misma frase para todos. Estas pruebas fijan que cada rechazo lleve una ACCIÓN distinta, porque
 * es lo único que separa un mensaje útil de uno que la persona no puede resolver.
 */
import { rejectionCopyFor, reviewCopyFor } from '../../src/modules/credit/domain/statement-rejection.js';

describe('motivo de rechazo de un extracto', () => {
  it('separa los tres casos que exigen acciones distintas', () => {
    const noEsExtracto = rejectionCopyFor('NOT_A_FINANCIAL_STATEMENT');
    const manipulado = rejectionCopyFor('TAMPERED_DOCUMENT');
    const cortoDePeriodo = rejectionCopyFor('INSUFFICIENT_STATEMENT_PERIOD');

    expect(noEsExtracto.category).toBe('NO_ES_EXTRACTO');
    expect(manipulado.category).toBe('DOCUMENTO_MANIPULADO');
    expect(cortoDePeriodo.category).toBe('PERIODO_INSUFICIENTE');

    // Y las tres frases son distintas: si coincidieran, la separación de categorías sería
    // contabilidad interna que el cliente no ve.
    const mensajes = new Set([noEsExtracto.message, manipulado.message, cortoDePeriodo.message]);
    expect(mensajes.size).toBe(3);
  });

  it('el rechazo por periodo pide TRES meses de forma explícita', () => {
    expect(rejectionCopyFor('INSUFFICIENT_STATEMENT_PERIOD').message).toContain('3 meses');
  });

  it('el rechazo por manipulación NO revela qué señal lo delató', () => {
    /*
     * Decirle a quien manipuló un extracto qué señal exacta lo delató es enseñarle qué evitar la
     * próxima vez, y a un cliente honesto no le sirve de nada. El detalle técnico queda en la fila.
     */
    const copia = rejectionCopyFor('TAMPERED_DOCUMENT');
    expect(copia.message).not.toMatch(/photoshop|producer|metadat|revisi[oó]n incremental/i);
    expect(copia.message.toLowerCase()).toContain('descarga');
  });

  it('un código desconocido cae en la afirmación MÁS DÉBIL, no en la más grave', () => {
    /*
     * Equivocarse hacia la más débil es lo correcto cuando falta información: decirle a alguien que
     * su documento está manipulado sin estar seguro es una acusación.
     */
    expect(rejectionCopyFor('ALGO_QUE_NO_EXISTE').category).toBe('LECTURA_INSUFICIENTE');
    expect(rejectionCopyFor(null).category).toBe('LECTURA_INSUFICIENTE');
  });

  it('la revisión humana se dice distinto del rechazo: el documento sirve', () => {
    const enRevision = reviewCopyFor('SUSPECTED_TAMPERING');
    expect(enRevision.title).toContain('revisión');
    expect(enRevision.message).not.toContain('No pudimos usar');
  });
});
