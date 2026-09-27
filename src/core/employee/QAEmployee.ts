import fs from "fs-extra";
import { OllamaClient } from "./OllamaClient";
import { ContextBuilder } from "./context/ContextBuilder";
import { JsonParser } from "./utils/JsonParser";
import { SYSTEM_PROMPT } from "./prompts/SystemPrompt";
import bundledKnowledge from "./knowledge/gyansetu.json";
import type { PageQAResult } from "../qa/Types";
import { FailureAnalyzer } from "../ai/reasoner/FailureAnalyzer";
import { AQWRuntime } from "../runtime/AQWRuntimeConfig";
import { ProductMemory } from "../memory/ProductMemory";

export interface KnowledgeSource {
  path: string;
  data: Record<string, unknown>;
}

export class QAEmployee {

  private readonly ai = new OllamaClient();
  private readonly failureAnalyzer = new FailureAnalyzer();

  /**
   * Resolves the module knowledge base for the active product:
   * memory/products/<productId>/knowledge.json when it exists, otherwise
   * the bundled default knowledge (seeded into the product's memory on
   * first use so the product owns its knowledge base going forward).
   */
  static resolveKnowledgeSource(): KnowledgeSource {
    const productId = QAEmployee.resolveProductId();

    if (productId) {
      const candidate = ProductMemory.knowledgePath(productId);

      if (fs.existsSync(candidate)) {
        try {
          return {
            path: candidate,
            data: fs.readJsonSync(candidate)
          };
        } catch (error) {
          console.error(
            `Could not read product knowledge at ${candidate}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      try {
        fs.writeJsonSync(candidate, bundledKnowledge, {
          spaces: 2
        });

        return {
          path: candidate,
          data: bundledKnowledge as Record<string, unknown>
        };
      } catch (error) {
        console.error(
          `Could not seed product knowledge at ${candidate}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return {
      path: "bundled:./knowledge/gyansetu.json",
      data: bundledKnowledge as Record<string, unknown>
    };
  }

  private static resolveProductId(): string | undefined {
    try {
      return AQWRuntime.resolve().productId;
    } catch {
      return undefined;
    }
  }

  async analyze(results: PageQAResult[]) {

    const knowledgeSource = QAEmployee.resolveKnowledgeSource();
    const knowledge = knowledgeSource.data;

    console.log(`Knowledge base: ${knowledgeSource.path}`);

    for (const result of results) {

      const context = ContextBuilder.build(result);

      const deterministicFindings =
        this.failureAnalyzer.analyze(result);

      const moduleKnowledge =
        (knowledge as any)?.[result.module] ??
        (knowledge as any)?.modules?.[result.module] ??
        (knowledge as any)?.[result.module.toLowerCase()] ??
        {};

      const prompt = `
Module:
${result.module}

Page:
${result.page}

Business Knowledge:
${JSON.stringify(moduleKnowledge, null, 2)}

Deterministic QA Findings:
${JSON.stringify(deterministicFindings, null, 2)}

Evidence:
${JSON.stringify(context, null, 2)}

Instructions:
- Treat deterministic QA findings as verified observations from the QA engine.
- Do not contradict verified evidence.
- Do not invent failures that are not supported by the evidence.
- Explain probable causes only when evidence supports the inference.
- Prioritize recommendations according to business risk.

Return ONLY JSON.
`;

      try {

        console.time(result.page);

        const response = await this.ai.generate(prompt, SYSTEM_PROMPT);

        console.timeEnd(result.page);

        console.log("\n====================================================");
        console.log(`AI Response for: ${result.module} -> ${result.page}`);
        console.log("====================================================");
        console.log(response);
        console.log("====================================================\n");

        result.aiAnalysis = JsonParser.parse(response);

        console.log("Parsed AI Analysis:");
        console.dir(result.aiAnalysis, { depth: null });
        console.log("====================================================\n");

      } catch (err) {

        console.error(
          `QAEmployee failed for ${result.module} -> ${result.page}`,
          err
        );

        result.aiAnalysis = {
          summary: "AI analysis unavailable.",
          risk: "LOW",
          confidence: 0,
          rootCauses: [],
          remediations: []
        };

      }

    }

  }

}