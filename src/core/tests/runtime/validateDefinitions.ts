import { TestDefinitionLoader } from "./TestDefinitionLoader";

async function main(): Promise<void> {
  const loader = new TestDefinitionLoader();
  const suites = await loader.loadAll();

  let totalTests = 0;
  let readOnly = 0;
  let safeInteraction = 0;
  let dataCreation = 0;
  let destructive = 0;

  console.log("");
  console.log("========================================");
  console.log("       BUSINESS TEST DEFINITIONS");
  console.log("========================================");
  console.log("");

  for (const suite of suites) {
    const tests = loader.getEnabledTests(suite);
    totalTests += tests.length;

    for (const test of tests) {
      if (test.executionMode === "READ_ONLY") readOnly++;
      if (test.executionMode === "SAFE_INTERACTION") safeInteraction++;
      if (test.executionMode === "DATA_CREATION") dataCreation++;
      if (test.executionMode === "DESTRUCTIVE") destructive++;
    }

    console.log(`📦 ${suite.module}`);
    console.log(`   Feature : ${suite.feature}`);
    console.log(`   Suite   : ${suite.name}`);
    console.log(`   Tests   : ${tests.length}`);

    for (const test of tests) {
      console.log(
        `   • ${test.id} | ${test.executionMode} | ${test.name}`
      );
    }

    console.log("");
  }

  console.log("========================================");
  console.log("              SUMMARY");
  console.log("========================================");
  console.log(`Suites            : ${suites.length}`);
  console.log(`Written tests     : ${totalTests}`);
  console.log(`Read-only         : ${readOnly}`);
  console.log(`Safe interaction  : ${safeInteraction}`);
  console.log(`Data creation     : ${dataCreation}`);
  console.log(`Destructive       : ${destructive}`);
  console.log("");
}

main().catch(error => {
  console.error("❌ Test-definition validation failed.");
  console.error(error);
  process.exitCode = 1;
});
