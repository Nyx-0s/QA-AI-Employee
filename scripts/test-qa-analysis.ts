import { OllamaClient } from "../src/employee/OllamaClient";

const evidence = {
  module: "Registration",
  status: "WARNING",
  page: "/registration",
  consoleErrors: [],
  networkErrors: [],
  businessTests: [
    {
      name: "Invalid Email",
      status: "WARNING",
      evidence: [
        "input type=email",
        "pattern attribute missing",
        "email accepted"
      ]
    }
  ]
};

const prompt = `
You are a Senior QA Engineer.

Analyze ONLY the supplied evidence.

Do not invent facts.

Return valid JSON only.

Schema:

{
  "summary": "...",
  "risk":"Low|Medium|High|Critical",
  "confidence":0,
  "rootCauses":[],
  "recommendations":[]
}

Evidence:

${JSON.stringify(evidence,null,2)}
`;

(async () => {
  const ai = new OllamaClient();
  const result = await ai.generate(prompt);
  console.log(result);
})();
