import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DomainError } from "../../kernel/index.js";
import { parseArtifact, type Artifact, type ArtifactStore } from "./ArtifactStore.js";

export interface FileArtifactStoreOptions {
  readonly filePath: string;
}

export class FileArtifactStore implements ArtifactStore {
  private readonly filePath: string;
  private readonly artifacts = new Map<string, Artifact>();

  constructor(options: FileArtifactStoreOptions) {
    this.filePath = options.filePath;
    mkdirSync(dirname(this.filePath), { recursive: true });
    for (const artifact of loadArtifacts(this.filePath)) {
      this.artifacts.set(artifact.id, artifact);
    }
  }

  save(artifact: Artifact): void {
    const validated = parseArtifact(artifact);
    this.artifacts.set(validated.id, { ...validated, ref: validated.ref });
    this.write();
  }

  get(artifactId: string): Artifact | null {
    return this.artifacts.get(artifactId) ?? null;
  }

  list(): Artifact[] {
    return [...this.artifacts.values()];
  }

  delete(artifactId: string): void {
    if (this.artifacts.delete(artifactId)) {
      this.write();
    }
  }

  private write(): void {
    writeFileSync(
      this.filePath,
      JSON.stringify({ version: 1, artifacts: [...this.artifacts.values()] }, null, 2),
      "utf8",
    );
  }
}

function loadArtifacts(filePath: string): Artifact[] {
  if (!existsSync(filePath)) {
    return [];
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw malformedFile(filePath, error instanceof Error ? error.message : String(error));
  }
  if (raw.trim().length === 0) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw malformedFile(filePath, error instanceof Error ? error.message : String(error));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw malformedFile(filePath, 'expected an object with an "artifacts" array');
  }
  const artifacts = (parsed as { artifacts?: unknown[] }).artifacts;
  if (!Array.isArray(artifacts)) {
    throw malformedFile(filePath, 'expected an object with an "artifacts" array');
  }
  try {
    return artifacts.map(parseArtifact);
  } catch (error) {
    throw malformedFile(filePath, error instanceof Error ? error.message : String(error));
  }
}

function malformedFile(filePath: string, detail: string): DomainError {
  return new DomainError({
    code: "INVALID_INPUT",
    message: `Malformed artifact store file "${filePath}": ${detail}`,
    details: { filePath, detail },
  });
}