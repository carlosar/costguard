import { describe, it, expect } from 'vitest';
import { unusedCloudFunctionRule } from '../../src/analyzer/rules/unused-cloud-function';

// FCG016 requires either a path containing /functions/ or a firebase-functions import
const FILE = 'functions/index.ts';

describe('FCG016 — Cloud Function defined but not exported', () => {
  it('fires on v2 onRequest not exported', () => {
    const src = `
      import * as functions from 'firebase-functions';
      const myFn = onRequest((req, res) => {
        res.send('hello');
      });
    `;
    const diags = unusedCloudFunctionRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG016');
  });

  it('fires on v2 onDocumentCreated not exported', () => {
    const src = `
      import * as functions from 'firebase-functions';
      const processDoc = onDocumentCreated('items/{id}', (event) => {
        console.log(event.data);
      });
    `;
    const diags = unusedCloudFunctionRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG016');
  });

  it('does not fire when function is exported with export keyword', () => {
    const src = `
      import * as functions from 'firebase-functions';
      export const myFn = onRequest((req, res) => {
        res.send('hello');
      });
    `;
    const diags = unusedCloudFunctionRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG016')).toHaveLength(0);
  });

  it('does not fire when function is exported via exports.xxx = ...', () => {
    const src = `
      const functions = require('firebase-functions');
      const myFn = onRequest((req, res) => { res.send('hi'); });
      exports.myFn = myFn;
    `;
    const diags = unusedCloudFunctionRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG016')).toHaveLength(0);
  });

  it('does not fire when file has no firebase-functions import and is not in /functions/ path', () => {
    const src = `
      const myFn = onRequest((req, res) => { res.send('hi'); });
    `;
    const diags = unusedCloudFunctionRule.analyze(src, 'src/components/MyComponent.tsx');
    expect(diags.filter(d => d.code === 'FCG016')).toHaveLength(0);
  });
});
