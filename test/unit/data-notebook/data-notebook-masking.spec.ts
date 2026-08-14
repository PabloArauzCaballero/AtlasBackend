import { describe, expect, it } from '@jest/globals';
import { applyColumnPolicies, describeColumns } from '../../../src/modules/data-notebook/data-notebook-masking.js';

/**
 * El enmascarado del cuaderno es la única capa que separa «analizar datos» de «extraer datos
 * personales», así que se fija aquí con el detalle con el que se aplica: qué columna se enmascara,
 * qué se conserva de cada categoría y qué no se sirve NUNCA.
 */
describe('describeColumns', () => {
  it('deja en claro las columnas sin señal de dato personal', () => {
    const [column] = describeColumns(['open_case_count'], false);
    expect(column.policy).toBe('PLAIN');
    expect(column.reason).toBeNull();
  });

  it('enmascara el dato personal cuando no hay permiso de ver en claro', () => {
    const [email, phone] = describeColumns(['contact_email', 'mobile_phone'], false);
    expect(email.policy).toBe('MASKED');
    expect(email.piiType).toBe('EMAIL');
    expect(phone.policy).toBe('MASKED');
    expect(phone.piiType).toBe('PHONE');
  });

  it('sirve el dato personal en claro con permiso, y lo dice', () => {
    const [email] = describeColumns(['contact_email'], true);
    expect(email.policy).toBe('PLAIN');
    expect(email.reason).toContain('permiso explícito');
  });

  /**
   * La regla que no puede aflojarse: el permiso de «ver en claro» existe para investigar un caso
   * con dato personal, no para leer credenciales por pantalla. Si esta prueba se pone verde
   * aceptando `PLAIN`, el rol más alto de la consola se convirtió en una extracción de secretos.
   */
  it('nunca sirve una credencial, ni siquiera con permiso de ver en claro', () => {
    for (const reveal of [false, true]) {
      const [token] = describeColumns(['refresh_token_hash'], reveal);
      expect(token.policy).toBe('REDACTED');
    }
  });
});

describe('applyColumnPolicies', () => {
  const rows = [
    { contact_email: 'pablo.arauz@atlas.internal', mobile_phone: '+59171234567', legal_name: 'Pablo Arauz', open_case_count: 3 },
  ];

  it('conserva el dominio del correo y esconde a la persona', () => {
    const columns = describeColumns(Object.keys(rows[0]), false);
    const [masked] = applyColumnPolicies(rows, columns);

    expect(masked.contact_email).toBe('p••••@atlas.internal');
    expect(masked.mobile_phone).toBe('••••67');
    expect(masked.legal_name).toBe('P••••');
    expect(masked.open_case_count).toBe(3);
  });

  it('no convierte un nulo en una máscara: «no hay dato» y «hay dato oculto» no son lo mismo', () => {
    const columns = describeColumns(['contact_email'], false);
    const [masked] = applyColumnPolicies([{ contact_email: null }], columns);
    expect(masked.contact_email).toBeNull();
  });

  it('no muta la fila original', () => {
    const columns = describeColumns(Object.keys(rows[0]), false);
    applyColumnPolicies(rows, columns);
    expect(rows[0].contact_email).toBe('pablo.arauz@atlas.internal');
  });
});
