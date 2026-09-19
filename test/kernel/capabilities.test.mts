import { expect } from "chai";
import { Capability, CapabilityRegistry } from "../../src/kernel/capabilities/index.js";
import { DomainError } from "../../src/kernel/DomainError.js";

describe("Capability", () => {
  it("should create a valid capability", () => {
    const cap = new Capability({
      id: "cap-1",
      type: "test-type",
      version: 1,
      metadata: { key: "value" },
    });
    expect(cap.id).to.equal("cap-1");
    expect(cap.type).to.equal("test-type");
    expect(cap.version).to.equal(1);
    expect(cap.metadata).to.deep.equal({ key: "value" });
  });

  it("should throw for empty id", () => {
    expect(() => new Capability({ id: " ", type: "t", version: 1 })).to.throw(DomainError);
  });

  it("should throw for empty type", () => {
    expect(() => new Capability({ id: "i", type: " ", version: 1 })).to.throw(DomainError);
  });

  it("should be immutable", () => {
    const cap = new Capability({ id: "cap-1", type: "t", version: 1 });
    expect(() => {
      (cap as any).id = "new-id";
    }).to.throw();
  });

  it("should verify equality correctly", () => {
    const cap1 = new Capability({ id: "cap-1", type: "t", version: 1 });
    const cap2 = new Capability({ id: "cap-1", type: "t", version: 1 });
    const cap3 = new Capability({ id: "cap-2", type: "t", version: 1 });
    const cap4 = new Capability({ id: "cap-1", type: "t", version: 2 });

    expect(cap1.equals(cap2)).to.be.true;
    expect(cap1.equals(cap3)).to.be.false;
    expect(cap1.equals(cap4)).to.be.false;
  });
});

describe("CapabilityRegistry", () => {
  let registry: CapabilityRegistry;

  beforeEach(() => {
    registry = new CapabilityRegistry();
  });

  it("should register and retrieve a capability", () => {
    const cap = new Capability({ id: "cap-1", type: "t", version: 1 });
    registry.register(cap);
    expect(registry.get("cap-1")).to.equal(cap);
  });

  it("should throw on duplicate registration", () => {
    const cap = new Capability({ id: "cap-1", type: "t", version: 1 });
    registry.register(cap);
    expect(() => registry.register(cap)).to.throw(DomainError);
  });

  it("should throw when getting unknown capability", () => {
    expect(() => registry.get("unknown")).to.throw(DomainError);
  });

  it("should check for existence", () => {
    const cap = new Capability({ id: "cap-1", type: "t", version: 1 });
    expect(registry.has("cap-1")).to.be.false;
    registry.register(cap);
    expect(registry.has("cap-1")).to.be.true;
  });

  it("should list registered capabilities", () => {
    const cap1 = new Capability({ id: "cap-1", type: "t", version: 1 });
    const cap2 = new Capability({ id: "cap-2", type: "t", version: 1 });
    registry.register(cap1);
    registry.register(cap2);
    const list = registry.list();
    expect(list).to.have.lengthOf(2);
    expect(list).to.include(cap1);
    expect(list).to.include(cap2);
  });

  it("should provide list isolation", () => {
    const cap = new Capability({ id: "cap-1", type: "t", version: 1 });
    registry.register(cap);
    const list = registry.list();
    (list as any).push(new Capability({ id: "cap-2", type: "t", version: 1 }));
    expect(registry.list()).to.have.lengthOf(1);
  });

  it("should remove capabilities", () => {
    const cap = new Capability({ id: "cap-1", type: "t", version: 1 });
    registry.register(cap);
    expect(registry.remove("cap-1")).to.be.true;
    expect(registry.has("cap-1")).to.be.false;
    expect(registry.remove("cap-1")).to.be.false;
  });
});
