import { readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { checkCompose, checkComposeFiles, composeEnvironment, valueWhenUnset } from '../../../scripts/compose-env-check.js';

/**
 * Los composes de despliegue frente al esquema de configuración.
 *
 * Lo que un compose no nombra no existe dentro del contenedor: `TWILIO_*`, `FCM_*`, `MALWARE_SCAN_*`,
 * `EXPEDIENTES_*` y `ERP_EVENTS_DELIVERY_*` estaban en el esquema y no en Coolify/producción, así que
 * ahí no había forma de encender SMS, push, WhatsApp ni la entrega de eventos al ERP. Estas pruebas
 * fijan el gate (`yarn check:env-example`) y lo prueban en negativo: un compose al que se le quita una
 * variable, o que la nombra mal, tiene que fallar.
 */
const coolify = readFileSync('docker-compose.coolify.yml', 'utf8');
const prod = readFileSync('docker-compose.prod.yml', 'utf8');

const without = (source: string, key: string): string => {
  const line = new RegExp(`^ {2}${key}:.*\\n`, 'm');
  expect(line.test(source)).toBe(true);
  return source.replace(line, '');
};

describe('composes de Coolify y producción frente al esquema', () => {
  it('los composes del repositorio cuadran', () => {
    expect(checkComposeFiles()).toEqual([]);
  });

  it('nombran lo que el informe encontró ausente', () => {
    const named = (source: string) => new Set(Object.keys(composeEnvironment(source)));
    const cool = named(coolify);
    const production = named(prod);
    for (const key of [
      'TWILIO_ACCOUNT_SID',
      'BREVO_API_KEY',
      'FCM_PROJECT_ID',
      'APNS_KEY_ID',
      'RESEND_API_KEY',
      'SENDGRID_API_KEY',
      'META_WHATSAPP_TOKEN',
      'OTP_SMS_FALLBACK_TO_EMAIL',
      'EVENTS_RELAY_V2_ENABLED',
      'NOTIFICATION_SMS_WEBHOOK_URL',
      'EXPEDIENTES_ENABLED',
      'MALWARE_SCAN_HOST',
      'ERP_EVENTS_DELIVERY_URL',
      'ERP_EVENTS_DELIVERY_SECRET',
    ]) {
      expect(cool.has(key)).toBe(true);
      expect(production.has(key)).toBe(true);
    }
  });

  describe('en negativo', () => {
    it('un compose que deja de nombrar una variable del esquema falla y dice cuál', () => {
      const findings = checkCompose('docker-compose.coolify.yml', without(coolify, 'TWILIO_ACCOUNT_SID'));
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain('TWILIO_ACCOUNT_SID');
      const prodFindings = checkCompose('docker-compose.prod.yml', without(prod, 'ERP_EVENTS_DELIVERY_URL'));
      expect(prodFindings[0]!.message).toContain('ERP_EVENTS_DELIVERY_URL');
    });

    it('`${VAR:-}` en un campo que rechaza la cadena vacía falla: el contenedor no arrancaría', () => {
      const broken = coolify.replace("MALWARE_SCAN_PORT: '${MALWARE_SCAN_PORT:-3310}'", "MALWARE_SCAN_PORT: '${MALWARE_SCAN_PORT:-}'");
      expect(broken).not.toBe(coolify);
      const findings = checkCompose('docker-compose.coolify.yml', broken);
      expect(findings.map((finding) => finding.message).join('\n')).toMatch(
        /MALWARE_SCAN_PORT: sin valor del operador el compose entrega "" y el esquema lo rechaza/,
      );
    });

    it('`${VAR:-}` donde la cadena vacía significa otra cosa que la ausencia falla (fail-closed pasaría a false)', () => {
      const broken = coolify.replace(
        "MALWARE_SCAN_FAIL_CLOSED: '${MALWARE_SCAN_FAIL_CLOSED:-true}'",
        "MALWARE_SCAN_FAIL_CLOSED: '${MALWARE_SCAN_FAIL_CLOSED:-}'",
      );
      expect(broken).not.toBe(coolify);
      const message = checkCompose('docker-compose.coolify.yml', broken)
        .map((finding) => finding.message)
        .join('\n');
      expect(message).toContain('MALWARE_SCAN_FAIL_CLOSED: la cadena vacía se lee como false y la ausencia como true');
    });

    it('la lista de exentas no puede quedarse con una variable que el compose ya nombra', () => {
      const named = coolify.replace('\nservices:\n', "\n  DB_READ_SSL: '${DB_READ_SSL:-}'\n\nservices:\n");
      const findings = checkCompose('docker-compose.coolify.yml', named);
      expect(findings.map((finding) => finding.message).join('\n')).toContain('DB_READ_SSL');
    });
  });

  describe('interpolación', () => {
    it.each([
      ['${A:-valor}', 'valor'],
      ['${A:-}', ''],
      ['${A}', ''],
      ['${A:?falta}', null],
      ['${A?falta}', null],
      ['literal', 'literal'],
    ])('%s -> %j', (raw, expected) => {
      expect(valueWhenUnset(raw)).toBe(expected);
    });
  });

  it('resuelve las mezclas de ancla `<<: *ancla` de cada servicio', () => {
    const environment = composeEnvironment(coolify);
    expect(environment.NODE_ENV).toBe('${NODE_ENV:-development}');
    expect(environment.APP_ROLE).toBeDefined();
  });
});
