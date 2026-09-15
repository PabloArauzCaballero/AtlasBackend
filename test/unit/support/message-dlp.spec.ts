import { describe, expect, it } from '@jest/globals';
import { inspectMessageBody, SUPPORT_NEVER_ASKS_WARNING } from '../../../src/modules/support/domain/message-dlp.js';

/**
 * La detección de secretos en el chat. El equilibrio importa tanto como la detección: un chat lleno
 * de `[REDACTADO]` deja de servir para atender a nadie y el equipo pide desactivarlo.
 */
describe('DLP de mensajes de soporte', () => {
  it('oculta un código de verificación cuando el contexto dice que lo es', () => {
    const result = inspectMessageBody('mi codigo es 483920, ¿lo necesitas?');
    expect(result.hasSecrets).toBe(true);
    expect(result.redactedText).not.toContain('483920');
    expect(result.findings.map((f) => f.kind)).toContain('OTP');
  });

  it('NO oculta un número de seis dígitos sin contexto de secreto', () => {
    const result = inspectMessageBody('mi cuota de este mes es 123456 bolivianos');
    expect(result.hasSecrets).toBe(false);
    expect(result.redactedText).toContain('123456');
  });

  it('oculta una contraseña declarada', () => {
    const result = inspectMessageBody('mi contraseña es Perro2026!');
    expect(result.hasSecrets).toBe(true);
    expect(result.redactedText).not.toContain('Perro2026!');
  });

  it('oculta un token bearer y una clave privada', () => {
    const bearer = inspectMessageBody('me sale error con Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(bearer.findings.map((f) => f.kind)).toContain('BEARER_TOKEN');

    const key = inspectMessageBody('-----BEGIN PRIVATE KEY-----\nMIIEvQ==\n-----END PRIVATE KEY-----');
    expect(key.findings.map((f) => f.kind)).toContain('PRIVATE_KEY');
    expect(key.redactedText).not.toContain('MIIEvQ');
  });

  it('deja intacto un mensaje normal y no inventa motivo de redacción', () => {
    const result = inspectMessageBody('Hola, pagué mi cuota ayer y sigue figurando pendiente.');
    expect(result.hasSecrets).toBe(false);
    expect(result.redactedText).toBe('Hola, pagué mi cuota ayer y sigue figurando pendiente.');
    expect(result.reason).toBeNull();
  });

  it('el aviso automático dice exactamente lo que Atlas nunca pide', () => {
    expect(SUPPORT_NEVER_ASKS_WARNING).toContain('nunca te pedirá');
    expect(SUPPORT_NEVER_ASKS_WARNING).toContain('código de verificación');
  });
});
