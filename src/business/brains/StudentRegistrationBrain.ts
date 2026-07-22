import type { BusinessContext } from "../BusinessContext";
import { BaseBusinessBrain } from "../common/BaseBusinessBrain";

export class StudentRegistrationBrain extends BaseBusinessBrain {
  readonly id = "student-registration";
  readonly name = "Student Registration Brain";

  supports(context: BusinessContext): boolean {
    return this.matches(context, [
      /student.*registration/,
      /registration.*student/,
      /student-registration/,
      /student\/registration/,
      /registration/
    ]);
  }
}
