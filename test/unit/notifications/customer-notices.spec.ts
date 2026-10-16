/**
 * @file Los avisos de «ya está hecho» al cliente: cuándo se escriben, con qué datos y adónde llevan.
 * @business Pablo (2026-10-16): «tu capacidad fue actualizada», «tu cuenta ha sido verificada», el extracto, la
 *   compra. Un aviso que no llega es tan malo como uno que llega dos veces o cada hora.
 * @system funciones puras de `customer-notices.ts`, el publicador y el guardián de plantillas por regla.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import {
  bankStatementNotice,
  creditApplicationNotice,
  creditLineNotice,
  formatoBolivianos,
} from '../../../src/modules/credit/application/customer-notices.js';
import { getEventDefinition } from '../../../src/modules/events/event-registry.js';
import { NotificationRulesService } from '../../../src/modules/notifications/notification-rules.service.js';

const base = { tenantId: '1', customerId: '53', creditLineId: '9' };

describe('creditLineNotice · sólo cuando la cifra cambia', () => {
  it('la primera línea con monto es «lista»', () => {
    const aviso = creditLineNotice({ ...base, trigger: 'onboarding', previousLimit: null, newLimit: 1500 });
    expect(aviso?.eventCode).toBe('credit_line.created');
    expect(aviso?.payload).toMatchObject({ newLimitText: '1.500', deepLink: '/', pushData: { deepLink: '/' }, visible: true });
    expect(aviso?.idempotencyKey).toBe('credit-line-9');
  });

  it('subida y bajada', () => {
    expect(creditLineNotice({ ...base, trigger: 'manual', previousLimit: 900, newLimit: 1275 })?.eventCode).toBe('credit_line.increased');
    expect(creditLineNotice({ ...base, trigger: 'delinquency', previousLimit: 1275, newLimit: 600 })?.eventCode).toBe(
      'credit_line.decreased',
    );
  });

  it('el recálculo que deja la misma cifra NO avisa (el barrido horario no llena la bandeja)', () => {
    expect(creditLineNotice({ ...base, trigger: 'manual', previousLimit: 1275, newLimit: 1275 })).toBeNull();
  });

  it('una primera línea en cero no se anuncia como «lista»', () => {
    expect(creditLineNotice({ ...base, trigger: 'onboarding', previousLimit: null, newLimit: 0 })).toBeNull();
  });

  it('la línea que sale de un extracto la avisa el extracto: no dos avisos del mismo hecho', () => {
    expect(creditLineNotice({ ...base, trigger: 'bank_statement', previousLimit: 900, newLimit: 1275 })).toBeNull();
  });
});

describe('bankStatementNotice', () => {
  it('aplicado lleva la línea nueva y abre el inicio', () => {
    const aviso = bankStatementNotice({ kind: 'applied', tenantId: '1', customerId: '53', reviewId: '7', newLimit: 1275 });
    expect(aviso.eventCode).toBe('bank_statement.applied');
    expect(aviso.payload).toMatchObject({ newLimitText: '1.275', deepLink: '/' });
    expect(aviso.idempotencyKey).toBe('bank-statement-7-applied');
  });

  it('rechazado lleva el motivo para la bandeja y abre la pantalla del extracto; el push no lo lleva', () => {
    const aviso = bankStatementNotice({ kind: 'rejected', tenantId: '1', customerId: '53', reviewId: '7', message: 'Faltan meses.' });
    expect(aviso.payload).toMatchObject({
      reason: 'Faltan meses.',
      deepLink: '/extracto-bancario',
      pushData: { deepLink: '/extracto-bancario' },
    });
    expect(JSON.stringify((aviso.payload as Record<string, unknown>).pushData)).not.toContain('Faltan');
  });

  it('cada desenlace tiene su evento registrado para el agregado cliente', () => {
    for (const kind of ['applied', 'line_held', 'rejected', 'in_review'] as const) {
      const aviso = bankStatementNotice({ kind, tenantId: '1', customerId: '53', reviewId: '7' });
      expect(getEventDefinition(aviso.eventCode)?.allowedAggregateTypes).toContain('customer');
    }
  });
});

describe('creditApplicationNotice', () => {
  it('sólo decisiones cerradas, con cliente', () => {
    expect(creditApplicationNotice({ tenantId: '1', customerId: '53', applicationId: '4', status: 'approved' })?.eventCode).toBe(
      'credit.application.approved',
    );
    expect(creditApplicationNotice({ tenantId: '1', customerId: '53', applicationId: '4', status: 'rejected' })?.payload).toMatchObject({
      deepLink: '/compras',
    });
    expect(creditApplicationNotice({ tenantId: '1', customerId: '53', applicationId: '4', status: 'under_review' })).toBeNull();
    expect(creditApplicationNotice({ tenantId: '1', customerId: null, applicationId: '4', status: 'approved' })).toBeNull();
  });
});

it('formatoBolivianos: miles con punto, sin decimales', () => {
  expect(formatoBolivianos(20000)).toBe('20.000');
  expect(formatoBolivianos(1275.4)).toBe('1.275');
});

/**
 * Guardián: cada canal de cada regla de CLIENTE tiene su plantilla sembrada. Sin ella el cliente lee
 * «Se registró el evento payment.confirmed» (medido en TEST el 2026-10-16).
 */
describe('guardián de plantillas de los avisos al cliente', () => {
  const dir = join(__dirname, '../../../src/database/migrations');
  const sembradas = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const m of text.matchAll(/'([a-z][a-z0-9_]*_(?:in_app|push|email|sms))'/g)) sembradas.add(m[1]!);
    for (const m of text.matchAll(/P\(\s*'([a-z][a-z0-9_]*)',\s*'(in_app|push|email|sms)'/g)) sembradas.add(`${m[1]}_${m[2]}`);
    // `customer_lifecycle_active_${template.channel}` con los canales de su lista.
    for (const m of text.matchAll(/`([a-z][a-z0-9_]*)_\$\{template\.channel\}`/g)) {
      for (const c of text.matchAll(/channel: '(in_app|push|email|sms)'/g)) sembradas.add(`${m[1]}_${c[1]}`);
    }
  }

  it('ninguna regla de cliente sale con el texto de respaldo', () => {
    const rules = new NotificationRulesService();
    const faltan = rules
      .listRuleEventCodes()
      .flatMap((code) => rules.getRulesForEvent(code))
      .filter((rule) => rule.recipientType === 'customer')
      .flatMap((rule) => rule.channels.map((channel) => `${rule.templatePrefix}_${channel}`))
      .filter((code) => !sembradas.has(code));
    expect(faltan).toEqual([]);
  });
});
