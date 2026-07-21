import type {
  BusinessTestDefinition,
} from "../tests/models/TestDefinition";

export interface ExecutionPlan {
  page: string;
  module: string;

  readOnly: BusinessTestDefinition[];
  safeInteraction: BusinessTestDefinition[];
  dataCreation: BusinessTestDefinition[];
  destructive: BusinessTestDefinition[];

  totalTests: number;
}
