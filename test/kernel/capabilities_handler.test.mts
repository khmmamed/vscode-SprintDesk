import { expect } from "chai";
import { Capability, CapabilityRegistry, CapabilityHandlerRegistry } from "../../src/kernel/capabilities/index.js";
import { DomainError } from "../../src/kernel/DomainError.js";

describe("CapabilityHandlerRegistry", () => {
  let handlerRegistry: CapabilityHandlerRegistry;
  let capRegistry: CapabilityRegistry;

  beforeEach(() => {
    handlerRegistry = new CapabilityHandlerRegistry();
    capRegistry = new CapabilityRegistry();
  });

  it("should register and resolve a handler", () => {
    const cap = new Capability({ id: "cap-1", type: "t", version: 1 });
    capRegistry.register(cap);

    const handler = {
      capabilityId: "cap-1",
      run: async (input: string, context: any) => `echo ${input}`,
    };

    handlerRegistry.register(handler);
    expect(handlerRegistry.get("cap-1")).to.equal(handler);
  });

  it("should throw on duplicate handler registration", () => {
    const handler = {
      capabilityId: "cap-1",
      run: async (input: any, context: any) => {},
    };
    handlerRegistry.register(handler);
    expect(() => handlerRegistry.register(handler)).to.throw(DomainError);
  });

  it("should throw when getting missing handler", () => {
    expect(() => handlerRegistry.get("unknown")).to.throw(DomainError);
  });

  it("should support independent handlers for different capabilities", () => {
    const h1 = { capabilityId: "cap-1", run: async (i: any, c: any) => "1" };
    const h2 = { capabilityId: "cap-2", run: async (i: any, c: any) => "2" };

    handlerRegistry.register(h1);
    handlerRegistry.register(h2);

    expect(handlerRegistry.get("cap-1")).to.equal(h1);
    expect(handlerRegistry.get("cap-2")).to.equal(h2);
  });

  it("should remove handlers", () => {
    const h1 = { capabilityId: "cap-1", run: async (i: any, c: any) => {} };
    handlerRegistry.register(h1);
    expect(handlerRegistry.remove("cap-1")).to.be.true;
    expect(handlerRegistry.has("cap-1")).to.be.false;
  });

  it("should provide list isolation", () => {
    const h1 = { capabilityId: "cap-1", run: async (i: any, c: any) => {} };
    handlerRegistry.register(h1);
    const list = handlerRegistry.list();
    (list as any).push({ capabilityId: "cap-2", run: async (i: any, c: any) => {} });
    expect(handlerRegistry.list()).to.have.lengthOf(1);
  });

  it("should maintain separate concerns between definition and handler", () => {
    const cap = new Capability({ id: "cap-1", type: "t", version: 1 });
    capRegistry.register(cap);

    // Definition exists, but handler doesn't yet
    expect(capRegistry.has("cap-1")).to.be.true;
    expect(handlerRegistry.has("cap-1")).to.be.false;

    const handler = { capabilityId: "cap-1", run: async (i: any, c: any) => {} };
    handlerRegistry.register(handler);

    expect(handlerRegistry.has("cap-1")).to.be.true;
  });
});
