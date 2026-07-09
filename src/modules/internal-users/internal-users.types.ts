export type InternalAccessProfile = {
  user: {
    id: string;
    tenantId: string;
    email: string;
    fullName: string;
    name: string;
    userCode: string | null;
    status: string;
    department: string | null;
    jobTitle: string | null;
    mustChangePassword: boolean;
    mfaEnabled: boolean;
    roles: string[];
    legacyRoles: string[];
    permissions: string[];
  };
};

export type InternalAuthResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
} & InternalAccessProfile;

export type CreateInternalUserInput = {
  tenantId: string;
  email: string;
  fullName: string;
  userCode: string | null;
  department: string;
  jobTitle: string | null;
  passwordHash: string;
  mustChangePassword: boolean;
  roleCodes: string[];
  legacyRoleCode: string;
  createdByInternalUserId: string | null;
};

export type InternalUserListItem = InternalAccessProfile['user'];
