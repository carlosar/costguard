import { describe, it, expect } from 'vitest';
import { openSecurityRulesRule } from '../../src/analyzer/rules/open-security-rules';
import { analyzeFile } from '../../src/analyzer';

const FILE = 'firestore.rules';
const run = (src: string) => openSecurityRulesRule.analyze(src, FILE);

const wrap = (body: string) => `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
${body}
  }
}
`;

describe('FCG025 — security rules grant public access', () => {
  it('fires on a wide-open wildcard match', () => {
    const diags = run(wrap(`    match /{document=**} { allow read, write: if true; }`));
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('FCG025');
    expect(diags[0].severity).toBe('error');
  });

  it('fires on an open read even when writes are protected', () => {
    const diags = run(wrap(`
    match /invoices/{id} {
      allow read: if true;
      allow write: if request.auth != null;
    }`));
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('read');
  });

  it('fires on Firebase test-mode rules and names the expiry date', () => {
    const diags = run(wrap(`    match /{document=**} { allow read, write: if request.time < timestamp.date(2027, 1, 15); }`));
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('2027, 1, 15');
  });

  it('fires on open Storage rules', () => {
    const src = `
      service firebase.storage {
        match /b/{bucket}/o {
          match /{allPaths=**} { allow read, write: if true; }
        }
      }
    `;
    expect(run(src)).toHaveLength(1);
  });

  // ── Must stay silent ──────────────────────────────────────────────────────

  it('does not fire when auth is required', () => {
    expect(run(wrap(`    match /users/{uid} { allow read, write: if request.auth != null && request.auth.uid == uid; }`))).toHaveLength(0);
  });

  it('does not fire on a locked-down ruleset', () => {
    expect(run(wrap(`    match /{document=**} { allow read, write: if false; }`))).toHaveLength(0);
  });

  it('does not fire on role lookups', () => {
    expect(run(wrap(`
    match /orders/{id} {
      allow write: if get(/databases/$(database)/documents/roles/$(request.auth.uid)).data.admin == true;
    }`))).toHaveLength(0);
  });

  it('does not fire on an ordinary request.time comparison', () => {
    // request.time on the RIGHT is a normal comparison, not an open-until gate.
    expect(run(wrap(`    match /events/{id} { allow read: if request.auth != null && resource.data.startsAt < request.time; }`))).toHaveLength(0);
  });

  it('does not fire on commented-out rules', () => {
    expect(run(wrap(`    match /x/{id} {
      // allow read, write: if true;
      allow read: if request.auth != null;
    }`))).toHaveLength(0);
  });

  it('does not run against JavaScript files', () => {
    // The literal text could appear in a string; the rule is .rules-only.
    expect(openSecurityRulesRule.analyze(`const s = "allow read, write: if true;";`, 'app.ts')).toHaveLength(0);
  });

  it('is reachable through analyzeFile for a .rules path', () => {
    const diags = analyzeFile(wrap(`    match /{document=**} { allow read, write: if true; }`), 'firestore.rules');
    expect(diags.map(d => d.code)).toContain('FCG025');
  });

  it('respects inline suppression comments', () => {
    const src = wrap(`    match /{document=**} {
      // costguard-disable-next-line FCG025
      allow read, write: if true;
    }`);
    expect(analyzeFile(src, 'firestore.rules')).toHaveLength(0);
  });
});
