import type { BusinessRegistry } from "./BusinessRegistry";
import { BusinessRegistryImpl } from "./BusinessRegistryImpl";
import {
  FeeCollectionBrain,
  StudentRegistrationBrain
} from "./brains";

export function createBusinessRegistry(): BusinessRegistry {
  const registry = new BusinessRegistryImpl();

  registry.register(new StudentRegistrationBrain());
  registry.register(new FeeCollectionBrain());

  return registry;
}
