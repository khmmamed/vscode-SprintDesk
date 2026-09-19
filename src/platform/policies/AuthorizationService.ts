import { PlatformError } from "../PlatformError.js";

export type Permission =
  | "pipeline.read"
  | "pipeline.create"
  | "pipeline.edit"
  | "pipeline.validate"
  | "pipeline.publish"
  | "capability.discover"
  | "capability.use"
  | "resource.discover"
  | "resource.use"
  | "run.read"
  | "run.start"
  | "run.cancel"
  | "artifact.read";

export type PolicyResourceType = "pipeline" | "capability" | "resource" | "run" | "artifact";

export interface Principal {
  readonly id: string;
  readonly roleIds?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Role {
  readonly id: string;
  readonly permissions: readonly Permission[];
}

export interface PolicyResource {
  readonly type: PolicyResourceType;
  readonly id?: string;
  readonly ownerId?: string;
}

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly principalId: string;
  readonly permission: Permission;
  readonly reason: string;
}

export const SYSTEM_PRINCIPAL: Principal = Object.freeze({ id: "system", roleIds: ["system"] });

const ALL_PERMISSIONS: readonly Permission[] = [
  "pipeline.read", "pipeline.create", "pipeline.edit", "pipeline.validate", "pipeline.publish",
  "capability.discover", "capability.use", "resource.discover", "resource.use",
  "run.read", "run.start", "run.cancel", "artifact.read",
];

export class AuthorizationService {
  private readonly roles = new Map<string, Role>();
  private readonly principals = new Map<string, Principal>();
  private readonly owners = new Map<string, string>();

  constructor() {
    this.roles.set("system", { id: "system", permissions: ALL_PERMISSIONS });
    this.principals.set(SYSTEM_PRINCIPAL.id, SYSTEM_PRINCIPAL);
  }

  registerRole(role: Role): Role {
    this.roles.set(role.id, Object.freeze({ id: role.id, permissions: Object.freeze([...role.permissions]) }));
    return this.roles.get(role.id)!;
  }

  registerPrincipal(principal: Principal): Principal {
    const registered = Object.freeze({ ...principal, roleIds: Object.freeze([...(principal.roleIds ?? [])]) });
    this.principals.set(principal.id, registered);
    return registered;
  }

  grantRole(principalId: string, roleId: string): Principal {
    const principal = this.principals.get(principalId);
    if (!principal || !this.roles.has(roleId)) {
      throw new PlatformError("INVALID_PLATFORM_OPERATION", "Principal or role is not registered", { principalId, roleId });
    }
    return this.registerPrincipal({ ...principal, roleIds: [...(principal.roleIds ?? []), roleId] });
  }

  setOwner(resource: PolicyResource, ownerId: string): void {
    this.owners.set(this.key(resource), ownerId);
  }

  decide(principal: Principal | string | undefined, permission: Permission, resource?: PolicyResource): PolicyDecision {
    const resolved = this.resolvePrincipal(principal);
    if (resolved.id === SYSTEM_PRINCIPAL.id) {
      return { allowed: true, principalId: resolved.id, permission, reason: "system principal" };
    }
    const roleIds = resolved.roleIds ?? [];
    const permissions = roleIds.flatMap((roleId) => this.roles.get(roleId)?.permissions ?? []);
    const hasPermission = permissions.includes(permission);
    const owner = resource === undefined ? undefined : this.owners.get(this.key(resource));
    const ownershipAllowed = owner === undefined || owner === resolved.id;
    const allowed = hasPermission && ownershipAllowed;
    return {
      allowed,
      principalId: resolved.id,
      permission,
      reason: allowed ? "role permission granted" : owner !== undefined && !ownershipAllowed ? "resource ownership denied" : "permission denied",
    };
  }

  assertAllowed(principal: Principal | string | undefined, permission: Permission, resource?: PolicyResource): void {
    const decision = this.decide(principal, permission, resource);
    if (!decision.allowed) {
      throw new PlatformError("POLICY_DENIED", `Principal "${decision.principalId}" is not allowed to ${permission}`, {
        principalId: decision.principalId,
        permission,
        reason: decision.reason,
        resource,
      });
    }
  }

  private resolvePrincipal(principal: Principal | string | undefined): Principal {
    if (principal === undefined) {
      return SYSTEM_PRINCIPAL;
    }
    const id = typeof principal === "string" ? principal : principal.id;
    const registered = this.principals.get(id);
    if (!registered) {
      throw new PlatformError("POLICY_DENIED", `Principal "${id}" is not registered`, { principalId: id });
    }
    return registered;
  }

  private key(resource: PolicyResource): string {
    return `${resource.type}:${resource.id ?? "*"}`;
  }
}