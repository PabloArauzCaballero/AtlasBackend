/**
 * @file Normalizaciones puras del alta (sin dependencias): dominio del correo y nombre completo.
 * @business Lo que se guarda para buscar y deduplicar clientes se normaliza igual siempre, sin PII extra.
 * @system Funciones puras extraídas de `CustomerOnboardingStartService` (AT-025) para que el servicio no crezca.
 */
import { normalizeSensitiveText } from '../../../common/utils/crypto/hash.util.js';

export function emailDomain(email: string | undefined): string | null {
  if (!email) return null;
  const domain = email.split('@')[1];
  return domain ? normalizeSensitiveText(domain) : null;
}

export function normalizeFullName(firstName?: string, lastName?: string): string | null {
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName.length === 0 ? null : fullName.toLocaleLowerCase('es-BO');
}
