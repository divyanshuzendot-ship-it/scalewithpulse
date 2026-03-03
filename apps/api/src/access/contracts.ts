export const INTERNAL_EMAIL_DOMAIN = '@adbuffs.com';

export enum UserRole {
  ADMIN = 'ADMIN',
  ANALYST = 'ANALYST',
  VIEWER = 'VIEWER',
}

// Database contract scaffold for next RBAC phase.
export interface InternalUserRecord {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Database contract scaffold for account-level permissions.
export interface AdAccountAccessRecord {
  id: string;
  userId: string;
  adAccountId: string;
  accessRole: UserRole;
  createdAt: string;
}
