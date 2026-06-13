import { describe, it, expect } from 'vitest';
import { computeRiskScore } from '../src/analyzer/scorer';
import type { RuleDiagnostic } from '../src/analyzer/types';

function diag(code: string): RuleDiagnostic {
  return { code, message: '', line: 0, startChar: 0, endChar: 0, severity: 'error' };
}

describe('computeRiskScore', () => {
  it('returns LOW across all categories for empty diagnostics', () => {
    const score = computeRiskScore([]);
    expect(score.overall).toBe(0);
    expect(score.costRisk).toBe('LOW');
    expect(score.scalabilityRisk).toBe('LOW');
    expect(score.memoryLeakRisk).toBe('LOW');
    expect(score.violationCount).toBe(0);
  });

  it('FCG001 (10 pts: cost + memoryLeak) → MEDIUM cost, MEDIUM memoryLeak, LOW scalability', () => {
    const score = computeRiskScore([diag('FCG001')]);
    expect(score.overall).toBe(10);
    expect(score.costRisk).toBe('MEDIUM');
    expect(score.memoryLeakRisk).toBe('MEDIUM');
    expect(score.scalabilityRisk).toBe('LOW');
    expect(score.violationCount).toBe(1);
  });

  it('FCG010 (35 pts: cost + scalability + memoryLeak) → HIGH in all categories', () => {
    const score = computeRiskScore([diag('FCG010')]);
    expect(score.overall).toBe(35);
    expect(score.costRisk).toBe('HIGH');
    expect(score.scalabilityRisk).toBe('HIGH');
    expect(score.memoryLeakRisk).toBe('HIGH');
  });

  it('FCG004 (22 pts: memoryLeak only) → LOW cost, LOW scalability, MEDIUM memoryLeak', () => {
    const score = computeRiskScore([diag('FCG004')]);
    expect(score.overall).toBe(22);
    expect(score.costRisk).toBe('LOW');
    expect(score.scalabilityRisk).toBe('LOW');
    expect(score.memoryLeakRisk).toBe('MEDIUM');
  });

  it('multiple violations accumulate points correctly', () => {
    // FCG001(10) + FCG004(22) + FCG005(20) = 52 total
    const score = computeRiskScore([diag('FCG001'), diag('FCG004'), diag('FCG005')]);
    expect(score.overall).toBe(52);
    expect(score.violationCount).toBe(3);
  });

  it('overall score caps at 100', () => {
    // FCG010(35) × 3 = 105, should cap at 100
    const score = computeRiskScore([diag('FCG010'), diag('FCG010'), diag('FCG010')]);
    expect(score.overall).toBe(100);
  });

  it('unknown rule codes contribute 0 points', () => {
    const score = computeRiskScore([diag('UNKNOWN')]);
    expect(score.overall).toBe(0);
    expect(score.costRisk).toBe('LOW');
  });

  it('FCG016 (10 pts: cost + scalability) → MEDIUM cost, MEDIUM scalability', () => {
    const score = computeRiskScore([diag('FCG016')]);
    expect(score.overall).toBe(10);
    expect(score.costRisk).toBe('MEDIUM');
    expect(score.scalabilityRisk).toBe('MEDIUM');
    expect(score.memoryLeakRisk).toBe('LOW');
  });

  it('HIGH threshold is exactly 25 points', () => {
    // FCG011 = 25 pts → HIGH
    const score = computeRiskScore([diag('FCG011')]);
    expect(score.costRisk).toBe('HIGH');
    expect(score.scalabilityRisk).toBe('HIGH');
  });

  it('MEDIUM threshold is 1–24 points', () => {
    // FCG003 = 12 pts cost only → MEDIUM cost
    const score = computeRiskScore([diag('FCG003')]);
    expect(score.overall).toBe(12);
    expect(score.costRisk).toBe('MEDIUM');
    expect(score.scalabilityRisk).toBe('LOW');
    expect(score.memoryLeakRisk).toBe('LOW');
  });
});
