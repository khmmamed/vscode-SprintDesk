import type { Artifact, ArtifactStore } from "./ArtifactStore.js";

export class MemoryArtifactStore implements ArtifactStore {
  private readonly artifacts = new Map<string, Artifact>();

  save(artifact: Artifact): void {
    const copy: Artifact = {
      id: artifact.id,
      type: artifact.type,
      name: artifact.name,
      ref: artifact.ref,
      metadata: artifact.metadata,
      createdAt: artifact.createdAt,
    };
    this.artifacts.set(artifact.id, copy);
  }

  get(artifactId: string): Artifact | null {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return null;
    }
    const copy: Artifact = {
      id: artifact.id,
      type: artifact.type,
      name: artifact.name,
      ref: artifact.ref,
      metadata: artifact.metadata,
      createdAt: artifact.createdAt,
    };
    return copy;
  }

  list(): Artifact[] {
    return [...this.artifacts.values()];
  }

  delete(artifactId: string): void {
    this.artifacts.delete(artifactId);
  }
}