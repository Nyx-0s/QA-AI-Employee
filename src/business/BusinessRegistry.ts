import type { BusinessBrain } from "./BusinessBrain";
import type { BusinessContext } from "./BusinessContext";

export interface BusinessRegistry {
  register(brain: BusinessBrain): void;

  resolve(context: BusinessContext): BusinessBrain[];

  getAll(): BusinessBrain[];
}
