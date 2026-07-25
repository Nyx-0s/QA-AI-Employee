export class CategoryResolver {
  resolve(result: any): string {
    const tests = result.businessTests ?? [];

    if (tests.length === 0) return "Test Coverage";

    if ((result.networkErrors?.length ?? 0) > 0) return "Backend/API";

    if ((result.consoleErrors?.length ?? 0) > 0) return "Frontend";

    if (tests.some((t:any)=>t.status==="FAIL")) return "Business Logic";

    return "General";
  }
}
