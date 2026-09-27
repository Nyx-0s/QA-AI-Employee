import axios from "axios";

export class OllamaClient {
  private readonly url = "http://localhost:11434/api/generate";
  private readonly model = "qwen2.5:7b";

  async generate(prompt: string, system?: string): Promise<string> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
      const response = await axios.post(
        this.url,
        {
          model: this.model,
          system,
          prompt,
          stream: false,
          options: {
            temperature: 0.15,
            top_p: 0.8,
            num_predict: 300,
            num_ctx: 4096,
            repeat_penalty: 1.1
          }
        },
        {
          timeout: 300000
        }
      );

      if (!response.data?.response) {
        throw new Error("Invalid response from Ollama.");
      }

      return response.data.response.trim();
      } catch (err: any) {
        if (attempt === 3) {
          throw new Error(`Ollama Error: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, attempt * 3000));
      }
    }

    throw new Error("Ollama failed after retries.");
  }
}
