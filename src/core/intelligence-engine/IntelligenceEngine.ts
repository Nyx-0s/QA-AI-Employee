import type { PageQAResult } from "../qa/Types";
import { EvidenceCollector } from "./EvidenceCollector";

export class IntelligenceEngine {

  private readonly collector =
    new EvidenceCollector();

  analyze(results: PageQAResult[]) {

    const evidence =
      this.collector.collect(results);

    console.log("");

    console.log("========== AQW Intelligence ==========");

    console.log(`Evidence Objects : ${evidence.length}`);

    console.log(
      `Business Tests   : ${
        evidence.filter(
          e => e.type==="BUSINESS_TEST"
        ).length
      }`
    );

    console.log(
      `Console Events   : ${
        evidence.filter(
          e => e.type==="CONSOLE"
        ).length
      }`
    );

    console.log(
      `Network Events   : ${
        evidence.filter(
          e => e.type==="NETWORK"
        ).length
      }`
    );

    console.log(
      `Pages            : ${
        evidence.filter(
          e => e.type==="PAGE"
        ).length
      }`
    );

    console.log("");

    return evidence;

  }

}
