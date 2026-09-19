import { expect } from "chai";
import { Resource, ResourceRegistry } from "../../src/kernel/resources/index.js";
import { DomainError } from "../../src/kernel/DomainError.js";

describe("Resource", () => {
  it("should create a valid resource", () => {
    const res = new Resource({
      id: "res-1",
      type: "test-type",
      version: "1.0.0",
      metadata: { key: "value" },
    });
    expect(res.id).to.equal("res-1");
    expect(res.type).to.equal("test-type");
    expect(res.version).to.equal("1.0.0");
    expect(res.metadata).to.deep.equal({ key: "value" });
  });

  it("should throw for empty id", () => {
    expect(() => new Resource({ id: " ", type: "t", version: "v" })).to.throw(DomainError);
  });

  it("should throw for empty type", () => {
    expect(() => new Resource({ id: "i", type: " ", version: "v" })).to.throw(DomainError);
  });

  it("should throw for empty version", () => {
    expect(() => new Resource({ id: "i", type: "t", version: " " })).to.throw(DomainError);
  });

  it("should be immutable", () => {
    const res = new Resource({ id: "res-1", type: "t", version: "v" });
    expect(() => {
      (res as any).id = "new-id";
    }).to.throw();
  });

  it("should defensively copy metadata", () => {
    const meta = { a: 1 };
    const res = new Resource({ id: "res-1", type: "t", version: "v", metadata: meta });
    meta.a = 2;
    expect(res.metadata.a).to.equal(1);
  });
});

describe("ResourceRegistry", () => {
  let registry: ResourceRegistry;

  beforeEach(() => {
    registry = new ResourceRegistry();
  });

  it("should register and retrieve a resource", () => {
    const res = new Resource({ id: "res-1", type: "t", version: "v" });
    registry.register(res);
    expect(registry.get("res-1")).to.equal(res);
  });

  it("should throw on duplicate registration", () => {
    const res = new Resource({ id: "res-1", type: "t", version: "v" });
    registry.register(res);
    expect(() => registry.register(res)).to.throw(DomainError);
  });

  it("should throw when getting unknown resource", () => {
    expect(() => registry.get("unknown")).to.throw(DomainError);
  });

  it("should check for existence", () => {
    const res = new Resource({ id: "res-1", type: "t", version: "v" });
    expect(registry.has("res-1")).to.be.false;
    registry.register(res);
    expect(registry.has("res-1")).to.be.true;
  });

  it("should list registered resources", () => {
    const res1 = new Resource({ id: "res-1", type: "t", version: "v" });
    const res2 = new Resource({ id: "res-2", type: "t", version: "v" });
    registry.register(res1);
    registry.register(res2);
    const list = registry.list();
    expect(list).to.have.lengthOf(2);
    expect(list).to.include(res1);
    expect(list).to.include(res2);
  });

  it("should provide list isolation", () => {
    const res = new Resource({ id: "res-1", type: "t", version: "v" });
    registry.register(res);
    const list = registry.list();
    (list as any).push(new Resource({ id: "res-2", type: "t", version: "v" }));
    expect(registry.list()).to.have.lengthOf(1);
  });

  it("should remove resources", () => {
    const res = new Resource({ id: "res-1", type: "t", version: "v" });
    registry.register(res);
    expect(registry.remove("res-1")).to.be.true;
    expect(registry.has("res-1")).to.be.false;
    expect(registry.remove("res-1")).to.be.false;
  });

  it("should maintain isolation between registries", () => {
    const registry2 = new ResourceRegistry();
    const res = new Resource({ id: "res-1", type: "t", version: "v" });
    registry.register(res);
    expect(registry2.has("res-1")).to.be.false;
  });
});
