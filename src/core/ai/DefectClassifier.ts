import { SeverityCalculator } from "./SeverityCalculator";
import { CategoryResolver } from "./CategoryResolver";
import { OwnerResolver } from "./OwnerResolver";

export class DefectClassifier {
  private severity = new SeverityCalculator();
  private category = new CategoryResolver();
  private owner = new OwnerResolver();

  classify(result:any){
    const category=this.category.resolve(result);
    return{
      severity:this.severity.calculate(result),
      category,
      owner:this.owner.resolve(category)
    };
  }
}
