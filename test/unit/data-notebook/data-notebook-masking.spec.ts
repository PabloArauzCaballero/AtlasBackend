import { describe, expect, it } from '@jest/globals';
import { applyColumnPolicies, describeColumns } from '../../../src/modules/data-notebook/data-notebook-masking.js';

/**
 * El enmascarado del cuaderno es la única capa que separa «analizar datos» de «extraer datos
 * personales», y a la vez la que puede dejar la pantalla sin nada que mirar. Las dos mitades se
 * fijan aquí con los nombres REALES de `read_api`, no con ejemplos inventados: los tres defectos
 * de abajo se midieron contra la base, no se imaginaron.
 */
describe('describeColumns · lo que NO debe taparse', () => {
  /**
   * El defecto que lo destapó todo: el clasificador del catálogo de gobierno busca por subcadena,
   * y «lat» (de ubicación) casa dentro de «latest». Un analista de riesgo veía enmascaradas las
   * tres columnas por las que abriría la pantalla.
   */
  it('no confunde «latest» con una coordenada', () => {
    for (const columna of ['latest_risk_score', 'latest_risk_band', 'latest_risk_decision', 'latest_risk_decided_at']) {
      const [descrito] = describeColumns([columna], false);
      expect({ columna, policy: descrito.policy }).toEqual({ columna, policy: 'PLAIN' });
    }
  });

  /**
   * Un identificador sustituto no identifica por sí solo, y sin él no se puede agrupar, contar ni
   * cruzar — que es todo lo que se hace en un cuaderno. Taparlo no protege a nadie y deja la tabla
   * inservible.
   */
  it('deja legibles las claves, aunque lleven «customer» en el nombre', () => {
    for (const columna of ['customer_id', 'customer_code', 'customer_uuid', 'latest_risk_assessment_run_id']) {
      const [descrito] = describeColumns([columna], false);
      expect({ columna, policy: descrito.policy }).toEqual({ columna, policy: 'PLAIN' });
    }
  });

  /**
   * `read_api` YA es la superficie desidentificada, y sus columnas se llaman así para anunciarlo.
   * El dominio de un correo es justo el agregado que permite preguntar «¿cuántos usan un correo
   * corporativo?»; volver a taparlo deshace un trabajo deliberado.
   */
  /**
   * `provider_name` es «SEGIP»: una institución, no alguien. Taparla dejaba la tabla de salud de
   * proveedores sin poder leerse, que es el mismo error que enmascarar el puntaje de riesgo — sólo
   * que al revés, escondiendo algo público.
   */
  it('no toma por persona el nombre de una entidad', () => {
    for (const columna of ['provider_name', 'template_name', 'system_name']) {
      const [descrito] = describeColumns([columna], false);
      expect({ columna, policy: descrito.policy }).toEqual({ columna, policy: 'PLAIN' });
    }
    // Pero un correo sigue siendo un correo aunque sea el de un proveedor.
    const [correoProveedor] = describeColumns(['provider_email'], false);
    expect(correoProveedor.policy).toBe('MASKED');
  });

  it('respeta las columnas que la vista publica ya tratadas', () => {
    for (const columna of ['primary_email_domain', 'primary_phone_last_4']) {
      const [descrito] = describeColumns([columna], false);
      expect({ columna, policy: descrito.policy }).toEqual({ columna, policy: 'PLAIN' });
      expect(descrito.reason).toContain('read_api');
    }
  });
});

describe('describeColumns · lo que SÍ debe taparse', () => {
  it('enmascara el dato personal que sigue siendo crudo', () => {
    const [nombre, nacimiento, correo, telefono] = describeColumns(['display_name', 'birth_date', 'contact_email', 'mobile_phone'], false);
    expect(nombre.policy).toBe('MASKED');
    expect(nacimiento.policy).toBe('MASKED');
    expect(correo.piiType).toBe('EMAIL');
    expect(correo.policy).toBe('MASKED');
    expect(telefono.piiType).toBe('PHONE');
    expect(telefono.policy).toBe('MASKED');
  });

  it('sirve el dato personal en claro con permiso, y lo dice', () => {
    const [correo] = describeColumns(['contact_email'], true);
    expect(correo.policy).toBe('PLAIN');
    expect(correo.reason).toContain('permiso explícito');
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
    { contact_email: 'pablo.arauz@atlas.internal', mobile_phone: '+59171234567', display_name: 'Pablo Arauz', customer_id: '7' },
  ];

  it('conserva el dominio del correo y esconde a la persona', () => {
    const columns = describeColumns(Object.keys(rows[0]), false);
    const [masked] = applyColumnPolicies(rows, columns);

    expect(masked.contact_email).toBe('p••••@atlas.internal');
    expect(masked.mobile_phone).toBe('••••67');
    expect(masked.display_name).toBe('P••••');
    // La clave, intacta: es por lo que se agrupa.
    expect(masked.customer_id).toBe('7');
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
