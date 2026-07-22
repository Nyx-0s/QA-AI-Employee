export class OwnerResolver {
  resolve(category: string): string {
    switch(category){
      case "Backend/API": return "Backend";
      case "Frontend": return "Frontend";
      case "Business Logic": return "Backend";
      default: return "QA";
    }
  }
}
