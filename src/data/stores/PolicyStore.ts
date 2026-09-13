import * as path from 'path';
import * as yaml from 'js-yaml';
import { getFileSystem, getHost, IFileSystem } from '../../host';
import { DEFAULT_POLICY, Employee, PermissionId, Policy } from '../types';

export class PolicyStore {
  private readonly filePath: string;
  private readonly fileSystem: IFileSystem;

  constructor(workspaceRoot?: string) {
    const root = workspaceRoot || getHost().getWorkspaceRoot() || '';
    this.filePath = path.join(root, '.SprintDesk', 'workforce', 'policy.yml');
    this.fileSystem = getFileSystem();
  }

  load(): Policy {
    try {
      if (!this.fileSystem.exists(this.filePath)) {
        return DEFAULT_POLICY;
      }
      const content = this.fileSystem.readFile(this.filePath);
      const data = yaml.load(content) as { policy?: Policy };
      const policy = data.policy;
      if (!policy || !policy.roles) {
        return DEFAULT_POLICY;
      }
      return { ...DEFAULT_POLICY, ...policy, roles: policy.roles };
    } catch {
      return DEFAULT_POLICY;
    }
  }

  save(policy: Policy): void {
    this.fileSystem.mkdir(path.dirname(this.filePath), { recursive: true });
    this.fileSystem.writeFile(this.filePath, yaml.dump({ policy: { ...policy, updatedAt: new Date().toISOString() } }));
  }

  ensureDefault(): void {
    if (!this.fileSystem.exists(this.filePath)) {
      this.save(DEFAULT_POLICY);
    }
  }

  getRolePermissions(role: string): PermissionId[] {
    return this.load().roles[role] || [];
  }

  getEmployeePermissions(employee: Employee): PermissionId[] {
    const policy = this.load();
    const role = employee.teamRole || (employee.role === 'agent' ? 'agent' : 'developer');
    const granted = new Set(policy.roles[role] || []);

    const override = (policy.overrides || []).find(o => o.employeeId === employee.id);
    if (override) {
      for (const p of override.allow || []) {
        granted.add(p);
      }
      for (const p of override.deny || []) {
        granted.delete(p);
      }
    }

    return [...granted];
  }

  hasPermission(employee: Employee, permission: PermissionId): boolean {
    return this.getEmployeePermissions(employee).includes(permission);
  }
}