import { SourceFile } from 'ts-morph';

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
  /** Pass a pre-parsed `sharedSf` from the caller to avoid redundant Project creation. */
  analyze(sourceText: string, filePath: string, sharedSf?: SourceFile): RuleDiagnostic[];
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
