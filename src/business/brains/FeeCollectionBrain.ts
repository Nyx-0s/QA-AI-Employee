import type { BusinessContext } from "../BusinessContext";
import { BaseBusinessBrain } from "../common/BaseBusinessBrain";

export class FeeCollectionBrain extends BaseBusinessBrain {
  readonly id = "fee-management";
  readonly name = "Fee Management Brain";

  supports(context: BusinessContext): boolean {
    return this.matches(context, [
      /collect.*fee/,
      /fee.*collect/,
      /fee-collection/,
      /fee\/collection/,
      /fee.*header/,
      /fee-header/,
      /financial management/
    ]);
  }
}
