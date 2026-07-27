import { OllamaClient } from "../../employee/OllamaClient";
import { ContextBuilder } from "../../employee/context/ContextBuilder";
import { JsonParser } from "./utils/JsonParser";
import { SYSTEM_PROMPT } from "../../employee/prompts/SystemPrompt";
import knowledge from "../../employee/knowledge/gyansetu.json";
import type { PageQAResult } from "../qa/Types";

export class QAEmployee {

  private readonly ai = new OllamaClient();

  async analyze(results: PageQAResult[]) {

    for (const result of results) {

      const context = ContextBuilder.build(result);

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

Evidence:
${JSON.stringify(context, null, 2)}

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
          risk: "Low",
          confidence: 0,
          rootCauses: [],
          recommendations: []
        };

      }

    }

  }

}