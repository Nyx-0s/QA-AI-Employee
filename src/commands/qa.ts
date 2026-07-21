import { QAEngine } from "../core/qa/QAEngine";

export async function qaCommand(): Promise<void> {
  console.log("");
  console.log("========================================");
  console.log("      RFT Autonomous QA Workforce");
  console.log("========================================");
  console.log("");

  const engine = new QAEngine();

  await engine.run();
}
