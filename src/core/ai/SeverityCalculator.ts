export class SeverityCalculator {
  calculate(result: any): "Critical" | "High" | "Medium" | "Low" | "Info" {
    const tests = result.businessTests ?? [];

    if (tests.length === 0) return "Info";

    if (result.error) return "Critical";

    if ((result.networkErrors?.length ?? 0) > 0) return "High";

    if ((result.consoleErrors?.length ?? 0) > 0) return "Medium";

    return "Low";
  }
}
