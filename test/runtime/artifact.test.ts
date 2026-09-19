import * as assert from "assert";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DomainError } from "../../src/kernel/index.js";
import {
  FileArtifactStore,
  MemoryArtifactStore,
  parseArtifact,
  type Artifact,
} from "../../src/runtime/index.js";

describe("persistence/Artifact", () => {
  it("carries id, type, name, metadata, and a content ref", () => {
    const artifact: Artifact = {
      id: "a1",
      type: "report",
      name: "weekly",
      ref: { kind: "content", content: { rows: 10 } },
      metadata: { format: "json" },
      createdAt: 123,
    };
    assert.strictEqual(artifact.id, "a1");
    assert.strictEqual(artifact.type, "report");
    assert.strictEqual(artifact.name, "weekly");
    assert.deepStrictEqual(artifact.ref, { kind: "content", content: { rows: 10 } });
    assert.deepStrictEqual(artifact.metadata, { format: "json" });
    assert.strictEqual(artifact.createdAt, 123);
  });

  it("carries a reference ref", () => {
    const artifact: Artifact = {
      id: "a2",
      type: "screenshot",
      name: "capture",
      ref: { kind: "reference", ref: "s3://bucket/cap.png" },
    };
    assert.deepStrictEqual(artifact.ref, { kind: "reference", ref: "s3://bucket/cap.png" });
  });

  it("parseArtifact accepts a valid artifact and is JSON-durable", () => {
    const artifact: Artifact = {
      id: "a3",
      type: "dataset",
      name: "users",
      ref: { kind: "content", content: [1, 2, 3] },
      metadata: { count: 3 },
      createdAt: 456,
    };
    const parsed = parseArtifact(JSON.parse(JSON.stringify(artifact)));
    assert.deepStrictEqual(parsed, artifact);
  });

  it("parseArtifact rejects malformed artifacts clearly", () => {
    const cases: unknown[] = [
      "not an object",
      [],
      { type: "t", name: "n", ref: { kind: "content", content: 1 } },
      { id: "  ", type: "t", name: "n", ref: { kind: "content", content: 1 } },
      { id: "a", type: " ", name: "n", ref: { kind: "content", content: 1 } },
      { id: "a", type: "t", name: "", ref: { kind: "content", content: 1 } },
      { id: "a", type: "t", name: "n", ref: { kind: "reference", ref: "  " } },
      { id: "a", type: "t", name: "n", ref: { kind: "content" } },
      { id: "a", type: "t", name: "n", ref: { kind: "blob" } },
      { id: "a", type: "t", name: "n", ref: { kind: "content", content: 1 }, metadata: "nope" },
      { id: "a", type: "t", name: "n", ref: { kind: "content", content: 1 }, createdAt: Number.NaN },
    ];
    for (const value of cases) {
      assert.throws(() => parseArtifact(value), (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.strictEqual((error as DomainError).code, "INVALID_INPUT");
        assert.ok((error as DomainError).message.includes("Malformed artifact data"));
        return true;
      });
    }
  });
});

describe("persistence/MemoryArtifactStore", () => {
  it("saves, gets, lists, and deletes artifacts", () => {
    const store = new MemoryArtifactStore();
    store.save({
      id: "a",
      type: "report",
      name: "weekly",
      ref: { kind: "content", content: { rows: 1 } },
    });
    store.save({
      id: "b",
      type: "screenshot",
      name: "capture",
      ref: { kind: "reference", ref: "file://cap.png" },
    });

    assert.strictEqual(store.get("b")?.ref.kind, "reference");
    assert.strictEqual(store.get("nope"), null);
    assert.strictEqual(store.list().length, 2);

    store.delete("a");
    assert.strictEqual(store.get("a"), null);
    assert.strictEqual(store.list().length, 1);
    assert.strictEqual(store.list()[0].id, "b");
  });

  it("isolates stored copies from the caller's object", () => {
    const store = new MemoryArtifactStore();
    const artifact: Artifact = {
      id: "a",
      type: "report",
      name: "weekly",
      ref: { kind: "content", content: { rows: 1 } },
      metadata: { format: "json" },
    };
    store.save(artifact);
    assert.notStrictEqual(store.get("a"), artifact);
    (store.get("a") as unknown as { name: string }).name = "changed";
    assert.strictEqual(store.get("a")!.name, "weekly");
    assert.deepStrictEqual(store.get("a")!.metadata, { format: "json" });
  });

  it("saving the same id overwrites the previous artifact", () => {
    const store = new MemoryArtifactStore();
    store.save({ id: "a", type: "first", name: "n", ref: { kind: "content", content: 1 } });
    store.save({ id: "a", type: "second", name: "n", ref: { kind: "content", content: 2 } });
    assert.strictEqual(store.list().length, 1);
    assert.strictEqual(store.get("a")!.type, "second");
  });
});

describe("persistence/FileArtifactStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sprintdesk-artifact-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a missing directory and treats a missing file as empty", () => {
    const store = new FileArtifactStore({ filePath: join(dir, "nested", "artifacts.json") });
    assert.strictEqual(store.list().length, 0);
    assert.strictEqual(store.get("nope"), null);
  });

  it("round-trips artifacts to disk", () => {
    const file = join(dir, "artifacts.json");
    const store = new FileArtifactStore({ filePath: file });
    store.save({
      id: "a",
      type: "report",
      name: "weekly",
      ref: { kind: "reference", ref: "s3://bucket/report.pdf" },
      metadata: { format: "pdf" },
      createdAt: 42,
    });
    store.save({
      id: "b",
      type: "dataset",
      name: "users",
      ref: { kind: "content", content: { rows: [1, 2, 3] } },
    });

    const reloaded = new FileArtifactStore({ filePath: file });
    const a = reloaded.get("a")!;
    assert.strictEqual(a.type, "report");
    assert.deepStrictEqual(a.ref, { kind: "reference", ref: "s3://bucket/report.pdf" });
    assert.deepStrictEqual(a.metadata, { format: "pdf" });
    assert.strictEqual(a.createdAt, 42);
    assert.deepStrictEqual(reloaded.get("b")!.ref, { kind: "content", content: { rows: [1, 2, 3] } });
    assert.strictEqual(reloaded.list().length, 2);
    assert.ok(existsSync(file));
  });

  it("persists deletes across a fresh store", () => {
    const file = join(dir, "artifacts.json");
    const store = new FileArtifactStore({ filePath: file });
    store.save({ id: "a", type: "t", name: "n", ref: { kind: "content", content: 1 } });
    store.delete("a");
    assert.strictEqual(new FileArtifactStore({ filePath: file }).list().length, 0);
  });

  it("rejects malformed JSON clearly", () => {
    const file = join(dir, "artifacts.json");
    writeFileSync(file, "{ not json", "utf8");
    assert.throws(
      () => new FileArtifactStore({ filePath: file }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.ok((error as DomainError).message.includes("Malformed artifact store file"));
        return true;
      },
    );
  });

  it("rejects a file without an artifacts array", () => {
    const file = join(dir, "artifacts.json");
    writeFileSync(file, JSON.stringify({ version: 1, runs: [] }), "utf8");
    assert.throws(
      () => new FileArtifactStore({ filePath: file }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.ok((error as DomainError).message.includes('expected an object with an "artifacts" array'));
        return true;
      },
    );
  });

  it("rejects malformed artifact records clearly", () => {
    const file = join(dir, "artifacts.json");
    writeFileSync(
      file,
      JSON.stringify({ version: 1, artifacts: [{ type: "t", name: "n", ref: { kind: "content", content: 1 } }] }),
      "utf8",
    );
    assert.throws(
      () => new FileArtifactStore({ filePath: file }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.ok((error as DomainError).message.includes("Malformed artifact data"));
        return true;
      },
    );
  });

  it("validates artifacts on save before persisting", () => {
    const file = join(dir, "artifacts.json");
    const store = new FileArtifactStore({ filePath: file });
    assert.throws(
      () => store.save({ id: "a", type: "t", name: "n", ref: { kind: "content" } } as unknown as Artifact),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.strictEqual((error as DomainError).code, "INVALID_INPUT");
        return true;
      },
    );
    assert.strictEqual(new FileArtifactStore({ filePath: file }).list().length, 0);
  });
});