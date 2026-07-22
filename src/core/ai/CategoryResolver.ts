export class CategoryResolver {
  resolve(result: any): string {
    if ((result.networkErrors?.length ?? 0) > 0) return "Backend/API";
    if ((result.consoleErrors?.length ?? 0) > 0) return "Frontend";
    if (result.businessTests?.some((t:any)=>t.status==="FAIL")) return "Business Logic";
    return "General";
  }
}
