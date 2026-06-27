import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import { AtlasUserRole } from '../src/common/types/auth.types.js';

const allowedRoles = new Set<AtlasUserRole>([
  'customer',
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'admin',
  'platform_admin',
]);

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

const role = readArg('role') ?? 'admin';
if (!allowedRoles.has(role as AtlasUserRole)) {
  throw new Error(`Rol inválido: ${role}`);
}

const tenantId = readArg('tenant-id');
const customerId = readArg('customer-id');
const internalUserId = readArg('internal-user-id');
const platformUserId = readArg('platform-user-id');

const subject = readArg('sub') ?? customerId ?? internalUserId ?? platformUserId ?? 'dev-user';
const payload = {
  sub: subject,
  role,
  ...(tenantId ? { tenantId } : {}),
  ...(customerId ? { customerId } : {}),
  ...(internalUserId ? { internalUserId } : {}),
  ...(platformUserId ? { platformUserId } : {}),
};

const options: SignOptions = {
  algorithm: 'HS256',
  expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN as SignOptions['expiresIn'],
};

const token = jwt.sign(payload, env.JWT_ACCESS_TOKEN_SECRET, options);
console.log(token);
