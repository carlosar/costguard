export interface RuleDiagnostic {
  /** Human-readable explanation + fix suggestion */
  message: string;
  /** 0-based line number */
  line: number;
  startChar: number;
  endChar: number;
  severity: 'error' | 'warning';
  /** e.g. FCG001 */
  code: string;
}

export interface Rule {
  id: string;
  analyze(sourceText: string, filePath: string): RuleDiagnostic[];
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RiskScore {
  /** 0–100 where higher = more risk */
  overall: number;
  costRisk: RiskLevel;
  scalabilityRisk: RiskLevel;
  memoryLeakRisk: RiskLevel;
  violationCount: number;
}
