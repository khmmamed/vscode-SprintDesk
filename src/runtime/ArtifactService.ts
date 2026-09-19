import type { Artifact } from "./persistence/ArtifactStore.js";

export interface ArtifactService {
  emit(artifact: Artifact): void;
}

export function createArtifactService(collect: (artifact: Artifact) => void): ArtifactService {
  return { emit: (artifact) => collect(artifact) };
}