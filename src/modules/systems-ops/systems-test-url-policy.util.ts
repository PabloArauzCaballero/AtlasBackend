/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ForbiddenException } from '@nestjs/common';
import { env } from '../../config/env.js';

export type SystemTestEnvironment = 'LOCAL' | 'STAGING' | 'PRODUCTION_READONLY';

const METADATA_HOSTS = new Set(['169.254.169.254', '169.254.170.2', 'metadata.google.internal', 'metadata']);

function configuredHosts(environment: SystemTestEnvironment): Set<string> {
  const raw =
    environment === 'LOCAL'
      ? env.SYSTEM_TEST_ALLOWED_HOSTS_LOCAL
      : environment === 'STAGING'
        ? env.SYSTEM_TEST_ALLOWED_HOSTS_STAGING
        : env.SYSTEM_TEST_ALLOWED_HOSTS_PRODUCTION_READONLY;
  return new Set(
    raw
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** IPv6 canónica (la misma forma que deja `new URL`): `0:0:…:1` → `::1`, `::ffff:10.0.0.1` → `::ffff:a00:1`. */
function canonicalIpv6(address: string): string {
  return new URL(`http://[${address.replace(/%.*$/, '')}]/`).hostname.replace(/^\[|\]$/g, '');
}

/** IPv4 mapeada en IPv6 (`::ffff:a00:1`) → punteada; si no lo es, null. */
function ipv4FromMapped(canonical: string): string | null {
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!hex) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

function isPrivateIpv4(address: string): boolean {
  const [a, b, c] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT y Tailscale
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 169 && b === 254)
  );
}

export function isPrivateOrMetadataAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (METADATA_HOSTS.has(normalized)) return true;
  const family = isIP(normalized);
  if (family === 4) return isPrivateIpv4(normalized);
  if (family !== 6) return false; // un nombre de host no es una dirección: lo juzga su resolución DNS
  const canonical = canonicalIpv6(normalized);
  if (canonical === '::1' || canonical === '::') return true;
  const mapped = ipv4FromMapped(canonical);
  if (mapped) return isPrivateIpv4(mapped);
  return /^fe[89ab]/.test(canonical) || canonical.startsWith('fc') || canonical.startsWith('fd');
}

export function assertHostAllowed(url: URL, environment: SystemTestEnvironment): void {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ForbiddenException('SYSTEM_TEST_URL_PROTOCOL_OR_CREDENTIALS_NOT_ALLOWED');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!configuredHosts(environment).has(hostname)) {
    throw new ForbiddenException('SYSTEM_TEST_HOST_NOT_IN_ENVIRONMENT_ALLOWLIST');
  }
  if (environment !== 'LOCAL' && (METADATA_HOSTS.has(hostname) || isPrivateOrMetadataAddress(hostname))) {
    throw new ForbiddenException('SYSTEM_TEST_TARGET_IS_INTERNAL_OR_METADATA');
  }
}

export async function assertResolvedTargetSafe(url: URL, environment: SystemTestEnvironment): Promise<void> {
  assertHostAllowed(url, environment);
  if (environment === 'LOCAL') return;
  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new ForbiddenException('SYSTEM_TEST_TARGET_DNS_RESOLUTION_FAILED');
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateOrMetadataAddress(address))) {
    throw new ForbiddenException('SYSTEM_TEST_TARGET_RESOLVES_TO_INTERNAL_OR_METADATA');
  }
}

export function buildAllowedTestUrl(baseUrl: string, path: string, environment: SystemTestEnvironment): URL {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new ForbiddenException('SYSTEM_TEST_PATH_MUST_BE_RELATIVE');
  }
  const base = new URL(baseUrl);
  assertHostAllowed(base, environment);
  const target = new URL(path, base);
  if (target.origin !== base.origin) throw new ForbiddenException('SYSTEM_TEST_TARGET_ORIGIN_CHANGED');
  return target;
}
