import { KnowledgeGenerator } from "../core/knowledge/KnowledgeGenerator";

export async function knowledgeCommand(): Promise<void> {
  console.log("");
  console.log("============================================");
  console.log("        RFT KNOWLEDGE GENERATION");
  console.log("============================================");
  console.log("");

  try {
    const generator = new KnowledgeGenerator();

    const { path: target, knowledge } = await generator.generate();

    const modules = Object.keys(knowledge).length;
    const pages = Object.values(knowledge).reduce(
      (total, module) => total + module.pageCount,
      0
    );

    console.log("✅ Generated product knowledge base:");
    console.log(`   Modules : ${modules}`);
    console.log(`   Pages   : ${pages}`);
    console.log(`   Written : ${target}`);
    console.log("");
    console.log(
      "   This knowledge now drives AI analysis for this product."
    );
  } catch (error) {
    console.error("");
    console.error("❌ Knowledge generation failed.");
    console.error(
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  }
}