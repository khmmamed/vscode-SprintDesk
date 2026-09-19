import type {
  Artifact,
  ArtifactLineage,
  ArtifactRef,
  ArtifactStore,
} from "../../runtime/persistence/ArtifactStore.js";
import type { AuthorizationService, Principal } from "../policies/AuthorizationService.js";

export interface ArtifactRetention {
  readonly policy: "retain" | "delete-after";
  readonly expiresAt?: number;
}

export interface ArtifactInfo extends Artifact {
  readonly retention?: ArtifactRetention;
}

export interface ArtifactFilter {
  readonly type?: string;
  readonly name?: string;
  readonly executionId?: string;
  readonly pipelineId?: string;
  readonly nodeId?: string;
}

export interface ArtifactInspection {
  readonly artifact: ArtifactInfo;
  readonly reference: ArtifactRef;
  readonly lineage?: ArtifactLineage;
}

export class ArtifactService {
  private readonly retention = new Map<string, ArtifactRetention>();

  constructor(readonly store: ArtifactStore, private readonly authorization?: AuthorizationService) {}

  get(id: string, actor?: Principal | string): ArtifactInfo | null {
    this.authorization?.assertAllowed(actor, "artifact.read", { type: "artifact", id });
    const artifact = this.store.get(id);
    return artifact === null ? null : this.toInfo(artifact);
  }

  list(filter: ArtifactFilter = {}, actor?: Principal | string): readonly ArtifactInfo[] {
    this.authorization?.assertAllowed(actor, "artifact.read", { type: "artifact" });
    return this.store.list()
      .map((artifact) => this.toInfo(artifact))
      .filter((artifact) => filter.type === undefined || artifact.type === filter.type)
      .filter((artifact) => filter.name === undefined || artifact.name === filter.name)
      .filter((artifact) => filter.executionId === undefined || artifact.lineage?.executionId === filter.executionId)
      .filter((artifact) => filter.pipelineId === undefined || artifact.lineage?.pipelineId === filter.pipelineId)
      .filter((artifact) => filter.nodeId === undefined || artifact.lineage?.nodeId === filter.nodeId);
  }

  byExecution(executionId: string): readonly ArtifactInfo[] {
    return this.list({ executionId });
  }

  byNode(executionId: string, nodeId: string): readonly ArtifactInfo[] {
    return this.list({ executionId, nodeId });
  }

  lineage(id: string): ArtifactLineage | undefined {
    return this.get(id)?.lineage;
  }

  inspect(id: string): ArtifactInspection | null {
    const artifact = this.get(id);
    if (artifact === null) {
      return null;
    }
    return { artifact, reference: artifact.ref, lineage: artifact.lineage };
  }

  read(id: string): ArtifactRef | null {
    return this.get(id)?.ref ?? null;
  }

  setRetention(id: string, retention: ArtifactRetention): ArtifactInfo | null {
    if (this.store.get(id) === null) {
      return null;
    }
    this.retention.set(id, retention);
    return this.get(id);
  }

  retentionOf(id: string): ArtifactRetention | undefined {
    return this.retention.get(id);
  }

  delete(id: string, actor?: Principal | string): void {
    this.authorization?.assertAllowed(actor, "artifact.read", { type: "artifact", id });
    this.retention.delete(id);
    this.store.delete(id);
  }

  private toInfo(artifact: Artifact): ArtifactInfo {
    const retention = this.retention.get(artifact.id);
    return retention === undefined ? artifact : { ...artifact, retention };
  }
}
