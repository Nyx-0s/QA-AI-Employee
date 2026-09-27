import readline from "readline";

export class InteractivePrompt {
  private readonly rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  ask(question: string): Promise<string> {
    return new Promise(resolve => {
      this.rl.question(question, answer => resolve(answer.trim()));
    });
  }

  async required(question: string): Promise<string> {
    while (true) {
      const value = await this.ask(question);

      if (value) {
        return value;
      }

      console.log("Value is required.");
    }
  }

  async yesNo(
    question: string,
    defaultValue = true
  ): Promise<boolean> {
    const suffix = defaultValue ? " [Y/n]: " : " [y/N]: ";
    const answer = (await this.ask(question + suffix)).toLowerCase();

    if (!answer) {
      return defaultValue;
    }

    return ["y", "yes"].includes(answer);
  }

  close(): void {
    this.rl.close();
  }
}
