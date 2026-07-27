import { OllamaClient } from "../src/employee/OllamaClient";

(async () => {
  const ai = new OllamaClient();

  const result = await ai.generate(
    "Reply with exactly the single word WORKING."
  );

  console.log(result);
})();
