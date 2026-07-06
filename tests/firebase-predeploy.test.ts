import { describe, it, expect } from 'vitest';
import { addFirebasePredeploy, FIREBASE_PREDEPLOY_CMD } from '../src/setup-helpers';

describe('addFirebasePredeploy', () => {
  it('adds predeploy to a target with none', () => {
    const out = addFirebasePredeploy(JSON.stringify({ hosting: { public: 'dist' } }, null, 2));
    expect(out).not.toBeNull();
    const cfg = JSON.parse(out!);
    expect(cfg.hosting.predeploy).toEqual([FIREBASE_PREDEPLOY_CMD]);
  });

  it('appends after an existing string predeploy', () => {
    const out = addFirebasePredeploy(JSON.stringify({
      functions: { source: 'functions', predeploy: 'npm run build' },
    }, null, 2));
    const cfg = JSON.parse(out!);
    expect(cfg.functions.predeploy).toEqual(['npm run build', FIREBASE_PREDEPLOY_CMD]);
  });

  it('appends after an existing array predeploy', () => {
    const out = addFirebasePredeploy(JSON.stringify({
      hosting: { public: 'dist', predeploy: ['npm run lint', 'npm run build'] },
    }, null, 2));
    const cfg = JSON.parse(out!);
    expect(cfg.hosting.predeploy).toEqual(['npm run lint', 'npm run build', FIREBASE_PREDEPLOY_CMD]);
  });

  it('handles multi-site hosting arrays', () => {
    const out = addFirebasePredeploy(JSON.stringify({
      hosting: [
        { site: 'app',   public: 'dist' },
        { site: 'admin', public: 'admin-dist', predeploy: 'npm run build:admin' },
      ],
    }, null, 2));
    const cfg = JSON.parse(out!);
    expect(cfg.hosting[0].predeploy).toEqual([FIREBASE_PREDEPLOY_CMD]);
    expect(cfg.hosting[1].predeploy).toEqual(['npm run build:admin', FIREBASE_PREDEPLOY_CMD]);
  });

  it('covers every supported target present in the config', () => {
    const out = addFirebasePredeploy(JSON.stringify({
      hosting:   { public: 'dist' },
      functions: { source: 'functions' },
      firestore: { rules: 'firestore.rules' },
      storage:   { rules: 'storage.rules' },
      database:  { rules: 'database.rules.json' },
      emulators: { ui: { enabled: true } },
    }, null, 2));
    const cfg = JSON.parse(out!);
    for (const target of ['hosting', 'functions', 'firestore', 'storage', 'database']) {
      expect(cfg[target].predeploy).toContain(FIREBASE_PREDEPLOY_CMD);
    }
    expect(cfg.emulators.predeploy).toBeUndefined();
  });

  it('is a no-op when costguard is already wired', () => {
    const raw = JSON.stringify({
      hosting: { public: 'dist', predeploy: [FIREBASE_PREDEPLOY_CMD] },
    }, null, 2);
    expect(addFirebasePredeploy(raw)).toBeNull();
  });

  it('is a no-op when no deploy targets exist', () => {
    expect(addFirebasePredeploy(JSON.stringify({ emulators: {} }, null, 2))).toBeNull();
  });

  it('returns null on unparseable input instead of throwing', () => {
    expect(addFirebasePredeploy('{ not json')).toBeNull();
    expect(addFirebasePredeploy('[]')).toBeNull();
  });

  it('preserves tab indentation', () => {
    const raw = '{\n\t"hosting": {\n\t\t"public": "dist"\n\t}\n}\n';
    const out = addFirebasePredeploy(raw);
    expect(out).toContain('\t"hosting"');
    expect(out).toContain(FIREBASE_PREDEPLOY_CMD);
  });

  it('preserves 4-space indentation', () => {
    const raw = '{\n    "hosting": {\n        "public": "dist"\n    }\n}\n';
    const out = addFirebasePredeploy(raw);
    expect(out!.split('\n')[1]).toMatch(/^ {4}"hosting"/);
  });
});
