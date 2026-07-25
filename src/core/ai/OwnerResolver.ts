export class OwnerResolver {
  resolve(category: string): string {
    switch (category) {
      case "Backend/API":
        return "Backend";

      case "Frontend":
        return "Frontend";

      case "Business Logic":
        return "Backend";

      case "Test Coverage":
        return "QA Automation";

      default:
        return "QA";
    }
  }
}
