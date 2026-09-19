import type { Resource, ResourceReference } from "../kernel/index.js";

export type ResolvedResources = Readonly<Record<string, Resource>>;

export interface ResourceResolver {
  resolve(reference: ResourceReference): Resource | Promise<Resource>;
}