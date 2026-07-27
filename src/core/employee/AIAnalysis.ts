export interface AIAnalysis {
  summary: string;
  risk: "Low" | "Medium" | "High" | "Critical";
  confidence: number;
  rootCauses: string[];
  recommendations: string[];
}
