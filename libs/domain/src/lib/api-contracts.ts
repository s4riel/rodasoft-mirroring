/** API <-> ERP contracts that do not depend on the OpenAPI-generated client. */
import type { BranchContext, CompanyContext } from './tenancy';
import type { Permission } from './permissions';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface SessionResponse {
  accessToken: string;
  expiresIn: number;
  user: CurrentUser;
}

export interface ContextResponse {
  user: CurrentUser;
  company: CompanyContext;
  branches: BranchContext[];
  role: { key: string; name: string };
  permissions: Permission[];
}

/** Single error shape of the API (see ProblemFilter in apps/api). */
export interface ApiProblem {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  traceId?: string;
}
