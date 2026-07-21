import { TestPlanner } from "./TestPlanner";

async function main() {

  const planner = new TestPlanner();

  const plan = await planner.createPlan(
    "Student Management",
    "Registration",
    "/student-registration"
  );

  console.log("\n========== EXECUTION PLAN ==========\n");

  console.log("Module        :", plan.module);
  console.log("Page          :", plan.page);
  console.log("Read Only     :", plan.readOnly.length);
  console.log("Safe          :", plan.safeInteraction.length);
  console.log("Create        :", plan.dataCreation.length);
  console.log("Destructive   :", plan.destructive.length);
  console.log("Total         :", plan.totalTests);
}

main().catch(console.error);
