import fs from "fs-extra";
import path from "path";
import { PageQAResult } from "../qa/Types";

export class EvidenceManager {
  constructor(
    private readonly outputDirectory = "reports/qa"
  ) {}

  async initialize(): Promise<void> {
    await fs.ensureDir(this.outputDirectory);
  }

  async save(results: PageQAResult[]): Promise<string> {
    await this.initialize();

    const fileName = `qa-results-${this.timestamp()}.json`;
    const filePath = path.resolve(this.outputDirectory, fileName);

    await fs.writeJson(
      filePath,
      {
        generatedAt: new Date().toISOString(),
        totalPages: results.length,
        passed: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      },
      {
        spaces: 2
      }
    );

    return filePath;
  }

  private timestamp(): string {
    return new Date()
      .toISOString()
      .replace(/[:.]/g, "-");
  }
}
