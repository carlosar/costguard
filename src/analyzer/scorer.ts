import { RuleDiagnostic, RiskLevel, RiskScore } from './types';

interface RuleProfile {
  categories: ('cost' | 'scalability' | 'memoryLeak')[];
  points: number;
}

const PROFILES: Record<string, RuleProfile> = {
  FCG001: { categories: ['cost', 'memoryLeak'],    points: 10 },
  FCG002: { categories: ['cost', 'scalability'],   points: 18 },
  FCG003: { categories: ['cost'],                  points: 12 },
  FCG004: { categories: ['memoryLeak'],            points: 22 },
  FCG005: { categories: ['cost', 'scalability'],   points: 20 },
  FCG006: { categories: ['memoryLeak'],            points: 18 },
  FCG007: { categories: ['memoryLeak'],            points: 15 },
  FCG008: { categories: ['cost', 'scalability'],   points: 20 },
  FCG009: { categories: ['cost', 'scalability'],   points: 16 },
};

function toLevel(pts: number): RiskLevel {
  if (pts === 0) return 'LOW';
  if (pts < 25)  return 'MEDIUM';
  return 'HIGH';
}

export function computeRiskScore(diagnostics: RuleDiagnostic[]): RiskScore {
  let total = 0, cost = 0, scalability = 0, memoryLeak = 0;

  for (const d of diagnostics) {
    const p = PROFILES[d.code];
    if (!p) continue;
    total       += p.points;
    if (p.categories.includes('cost'))        cost        += p.points;
    if (p.categories.includes('scalability')) scalability += p.points;
    if (p.categories.includes('memoryLeak'))  memoryLeak  += p.points;
  }

  return {
    overall:          Math.min(100, total),
    costRisk:         toLevel(cost),
    scalabilityRisk:  toLevel(scalability),
    memoryLeakRisk:   toLevel(memoryLeak),
    violationCount:   diagnostics.length,
  };
}
