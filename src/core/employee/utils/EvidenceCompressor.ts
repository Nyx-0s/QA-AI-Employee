export class EvidenceCompressor {
  static compress(result:any){

    return {
      page:result.page,
      module:result.module,

      score:result.score,

      consoleErrors:result.consoleErrors?.length ?? 0,
      networkErrors:result.networkErrors?.length ?? 0,

      inspection:result.inspection,

      businessTests:result.businessTests,

      findings:result.score?.findings
    }

  }
}
