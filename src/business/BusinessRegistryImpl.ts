import type { BusinessBrain } from "./BusinessBrain";
import type { BusinessContext } from "./BusinessContext";
import type { BusinessRegistry } from "./BusinessRegistry";

export class BusinessRegistryImpl implements BusinessRegistry {
  private readonly brains: BusinessBrain[] = [];

  register(brain: BusinessBrain): void {
    const exists = this.brains.some(
      registered => registered.id === brain.id
    );

    if (!exists) {
      this.brains.push(brain);
    }
  }

  resolve(context: BusinessContext): BusinessBrain[] {
    return this.brains.filter(brain => brain.supports(context));
  }

  getAll(): BusinessBrain[] {
    return [...this.brains];
  }
}
