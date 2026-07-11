import { lookup } from 'node:dns/promises';
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

export function isPrivateOrMetadataAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (METADATA_HOSTS.has(normalized) || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const parts = normalized.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
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
