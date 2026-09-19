import * as assert from "assert";
import { Graph, PipelineVersion, StateSchema } from "../../src/kernel/index.js";
import {
  AuthorizationService,
  Platform,
  PlatformError,
  type Permission,
} from "../../src/platform/index.js";

function emptyVersion(version: number): PipelineVersion {
  return new PipelineVersion({ version, graph: new Graph(), stateSchema: new StateSchema({ name: "policy" }) });
}

describe("Platform authorization", () => {
  it("denies unregistered principals before platform operations", () => {
    const authorization = new AuthorizationService();
    const platform = new Platform({ authorizationService: authorization });

    assert.throws(
      () => platform.pipelineService.create({ id: "denied", name: "Denied" }, "alice"),
      (error: unknown) => error instanceof PlatformError && error.code === "POLICY_DENIED"
    );
  });

  it("enforces role permissions and ownership at the platform boundary", async () => {
    const authorization = new AuthorizationService();
    const editorPermissions: Permission[] = ["pipeline.create", "pipeline.read", "pipeline.edit", "pipeline.validate", "pipeline.publish"];
    authorization.registerRole({ id: "editor", permissions: editorPermissions });
    authorization.registerRole({ id: "runner", permissions: ["run.start", "run.read", "run.cancel"] });
    authorization.registerPrincipal({ id: "alice", roleIds: ["editor", "runner"] });
    const platform = new Platform({ authorizationService: authorization });

    platform.pipelineService.create({ id: "owned", name: "Owned" }, "alice");
    authorization.setOwner({ type: "pipeline", id: "owned" }, "bob");
    assert.throws(
      () => platform.pipelineService.get("owned", "alice"),
      (error: unknown) => error instanceof PlatformError && error.code === "POLICY_DENIED"
    );

    authorization.setOwner({ type: "pipeline", id: "owned" }, "alice");
    platform.pipelineService.createVersion("owned", emptyVersion(1), "alice");
    platform.pipelineService.validate("owned", 1, "alice");
    platform.pipelineService.publish("owned", 1, "alice");
    const runId = platform.runService.start({ pipelineId: "owned", actor: "alice" });
    assert.ok(runId);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.strictEqual(platform.runService.get(runId, "alice").pipeline.id, "owned");
  });

  it("keeps the system principal compatible for internal callers", () => {
    const platform = new Platform();
    platform.pipelineService.create({ id: "system-owned", name: "System Owned" });
    assert.strictEqual(platform.pipelineService.get("system-owned").id, "system-owned");
  });
});