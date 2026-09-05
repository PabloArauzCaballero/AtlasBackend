import { describe, expect, it } from '@jest/globals';
import { classifyColumn, humanizeIdentifier } from '../../../src/modules/systems-ops/column-classification.util.js';

/**
 * La regla que decide qué se marca como sensible en el catálogo de gobierno — sin pruebas hasta
 * ahora, escondida como método privado de un servicio de 731 líneas.
 *
 * No es un detalle del seeding: `system_data_field_catalog` alimenta el portal de gobierno, el
 * mapeo de políticas de retención y la respuesta a "qué datos toca este endpoint". Si esta
 * clasificación falla, un campo con PII aparece como inocuo en todas esas superficies a la vez.
 */
describe('classifyColumn', () => {
  describe('categorías de PII y su precedencia', () => {
    it.each([
      ['customer_contact_methods', 'email_hash', 'EMAIL'],
      ['customers', 'primary_phone_hash', 'PHONE'],
      ['customers', 'mobile_number', 'PHONE'],
      ['customer_identity_documents', 'document_number', 'IDENTITY_DOCUMENT'],
      ['customers', 'dni', 'IDENTITY_DOCUMENT'],
      ['customer_addresses', 'address_line', 'LOCATION'],
      ['address_gps_observations', 'lat', 'LOCATION'],
      ['auth_credentials', 'password_hash', 'CREDENTIAL'],
      ['auth_refresh_tokens', 'token_hash', 'CREDENTIAL'],
    ])('%s.%s -> %s', (table, column, expected) => {
      expect(classifyColumn(column, table).piiType).toBe(expected);
    });

    /**
     * El orden de las categorías es una decisión, no un accidente: el tratamiento que exige un
     * correo (verificación, canal de contacto) manda sobre el de documento cuando la columna es
     * ambas cosas.
     */
    it('el correo gana al documento cuando el nombre contiene ambos', () => {
      expect(classifyColumn('identity_document_email', 'customers').piiType).toBe('EMAIL');
    });

    it('una columna sin señal reconocible no recibe categoría', () => {
      expect(classifyColumn('ordinal_position', 'schema_columns').piiType).toBeNull();
    });
  });

  /**
   * `containsPii` es MÁS amplio que `piiType`: recoge dato personal sin categoría propia. Un campo
   * de la tabla de clientes es dato personal aunque el nombre de la columna no diga qué es.
   */
  it('marca PII por señal indirecta aunque no haya categoría', () => {
    const signals = classifyColumn('full_name', 'customers');
    expect(signals.containsPii).toBe(true);
    expect(signals.piiType).toBeNull();
  });

  describe('otras señales de gobierno', () => {
    it('detecta dato financiero', () => {
      expect(classifyColumn('approved_amount', 'credit_applications').containsFinancialData).toBe(true);
      expect(classifyColumn('monthly_income', 'customer_financial_profiles').containsFinancialData).toBe(true);
    });

    it('detecta dato de riesgo y señal de fraude', () => {
      expect(classifyColumn('risk_score', 'risk_assessment_results').containsRiskData).toBe(true);
      expect(classifyColumn('device_fingerprint', 'device_snapshots').containsFraudSignal).toBe(true);
    });

    it('detecta candidatos a modelo', () => {
      expect(classifyColumn('feature_value', 'risk_features').isMlCandidate).toBe(true);
      expect(classifyColumn('prediction_score', 'ml_runs').usedInMl).toBe(true);
    });
  });

  /**
   * `containsSensitive` es la puerta que usa el resto del sistema para decidir si un campo necesita
   * tratamiento especial. Debe abrirse ante CUALQUIERA de las señales, no solo ante PII.
   */
  it('containsSensitive agrega todas las señales, no solo PII', () => {
    expect(classifyColumn('approved_amount', 'credit_applications').containsSensitive).toBe(true);
    expect(classifyColumn('risk_score', 'risk_assessment_results').containsSensitive).toBe(true);
    expect(classifyColumn('watchlist_hit', 'fraud_reviews').containsSensitive).toBe(true);
    expect(classifyColumn('email_hash', 'customer_contact_methods').containsSensitive).toBe(true);
  });

  it('una columna técnica no dispara ninguna señal', () => {
    const signals = classifyColumn('ordinal_position', 'schema_columns');
    expect(signals.containsSensitive).toBe(false);
    expect(signals.containsPii).toBe(false);
    expect(signals.isMlCandidate).toBe(false);
  });

  /**
   * La clasificación es por NOMBRE, no por contenido. Fijar el límite en una prueba evita que
   * alguien lea el catálogo como una garantía de que no hay PII sin marcar.
   */
  it('límite conocido: un nombre neutro que guarde PII no se detecta', () => {
    expect(classifyColumn('value_1', 'staging_items').containsPii).toBe(false);
  });
});

describe('humanizeIdentifier', () => {
  it('convierte snake_case en etiqueta legible', () => {
    expect(humanizeIdentifier('customer_contact_methods')).toBe('Customer Contact Methods');
  });

  it('tolera separadores repetidos y cadenas vacías', () => {
    expect(humanizeIdentifier('__risk__score__')).toBe('Risk Score');
    expect(humanizeIdentifier('')).toBe('');
  });
});
