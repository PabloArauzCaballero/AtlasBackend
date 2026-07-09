import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { isInternalOrSystemRole } from '../../../common/utils/auth/role-groups.util.js';

export type RequestContext = {
  tenantId: string;
  ipAddress: string | null;
  userAgent: string | null;
  idempotencyKey?: string;
};

export type DeviceRiskFlag = {
  eventType: string;
  reasonCode: string;
  evidence: Record<string, unknown>;
};

export function assertInternalAccess(user: AuthenticatedUser): void {
  if (!isInternalOrSystemRole(user.role)) {
    throw new ForbiddenException('Este endpoint es interno.');
  }
}

export function decimal(value: number | undefined, digits: number): string | null {
  if (value === undefined) return null;
  return value.toFixed(digits);
}

export function toDate(value: string | undefined, fallback: Date): Date {
  return value ? new Date(value) : fallback;
}

export function hasLocationPermission(input: {
  locationPermissionGranted?: boolean;
  permissions?: Array<{ permissionCode: string; granted: boolean }>;
  permissionChanges?: Array<{ permissionCode: string; granted: boolean }>;
}): boolean {
  if (input.locationPermissionGranted === true) return true;
  const permissions = input.permissions ?? input.permissionChanges ?? [];
  return permissions.some((permission) => permission.permissionCode === 'location' && permission.granted === true);
}

export function riskFlagsFromSnapshot(
  snapshot: { isRooted?: boolean; isEmulator?: boolean; vpnDetected?: boolean } | undefined,
  source: string,
): DeviceRiskFlag[] {
  if (!snapshot) return [];
  const flags: DeviceRiskFlag[] = [];
  if (snapshot.isRooted === true) {
    flags.push({ eventType: 'device_root_detected', reasonCode: 'rooted_device', evidence: { source, isRooted: true } });
  }
  if (snapshot.isEmulator === true) {
    flags.push({ eventType: 'device_emulator_detected', reasonCode: 'emulator_device', evidence: { source, isEmulator: true } });
  }
  if (snapshot.vpnDetected === true) {
    flags.push({ eventType: 'device_vpn_detected', reasonCode: 'vpn_detected', evidence: { source, vpnDetected: true } });
  }
  return flags;
}
