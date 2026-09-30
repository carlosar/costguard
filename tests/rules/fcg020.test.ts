import { describe, it, expect } from 'vitest';
import { clientSideAiKeyRule } from '../../src/analyzer/rules/client-side-ai-key';

const TSX = 'Chat.tsx';
const TS  = 'ai.ts';

describe('FCG020 — Gemini API key reachable from the browser', () => {
  it('fires on the raw SDK with a NEXT_PUBLIC key in a component', () => {
    const src = `
      import { GoogleGenerativeAI } from '@google/generative-ai';
      const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY);
    `;
    const diags = clientSideAiKeyRule.analyze(src, TSX);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('FCG020');
  });

  it('fires on a VITE_ key even in a plain .ts file', () => {
    // The prefix is the bundler's contract that the value is public, so the
    // file extension does not matter.
    const src = `
      import { GoogleGenerativeAI } from '@google/generative-ai';
      const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
    `;
    expect(clientSideAiKeyRule.analyze(src, TS)).toHaveLength(1);
  });

  it('fires on a REACT_APP_ key', () => {
    const src = `
      import { GoogleGenerativeAI } from '@google/generative-ai';
      const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_KEY);
    `;
    expect(clientSideAiKeyRule.analyze(src, TS)).toHaveLength(1);
  });

  it('fires on a hardcoded AIza key passed to the SDK', () => {
    const src = `
      import { GoogleGenerativeAI } from '@google/generative-ai';
      const genAI = new GoogleGenerativeAI('AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE');
    `;
    expect(clientSideAiKeyRule.analyze(src, TSX)).toHaveLength(1);
  });

  it('names the offending env var in the message', () => {
    const src = `
      import { GoogleGenerativeAI } from '@google/generative-ai';
      const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY);
    `;
    expect(clientSideAiKeyRule.analyze(src, TSX)[0].message).toContain('NEXT_PUBLIC_GEMINI_API_KEY');
  });

  // ── Must stay silent ──────────────────────────────────────────────────────

  it('does not fire on server-side use inside a callable', () => {
    const src = `
      import { onCall } from 'firebase-functions/v2/https';
      import { GoogleGenerativeAI } from '@google/generative-ai';
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      export const ask = onCall(async (request) => genAI.getGenerativeModel({ model: 'x' }));
    `;
    expect(clientSideAiKeyRule.analyze(src, TS)).toHaveLength(0);
  });

  it('does not fire in a firebase-admin backend module', () => {
    const src = `
      import * as admin from 'firebase-admin';
      import { GoogleGenerativeAI } from '@google/generative-ai';
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    `;
    expect(clientSideAiKeyRule.analyze(src, TS)).toHaveLength(0);
  });

  it('does not fire on a plain server env var in a non-client file', () => {
    const src = `
      import { GoogleGenerativeAI } from '@google/generative-ai';
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    `;
    expect(clientSideAiKeyRule.analyze(src, TS)).toHaveLength(0);
  });

  it('does not fire on Firebase AI Logic, which is built for client use', () => {
    // firebase/ai carries no raw key and is protected by App Check. Flagging it
    // would punish the pattern Firebase recommends.
    const src = `
      import { getAI, getGenerativeModel } from 'firebase/ai';
      export function Chat() {
        const model = getGenerativeModel(getAI(app), { model: 'gemini-2.0-flash' });
        return null;
      }
    `;
    expect(clientSideAiKeyRule.analyze(src, TSX)).toHaveLength(0);
  });

  it('does not fire on a firebaseConfig apiKey', () => {
    // Documented as not-a-secret; flagging it would hit every Firebase app.
    const src = `
      export const firebaseConfig = {
        apiKey: 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE',
        projectId: 'demo',
      };
    `;
    expect(clientSideAiKeyRule.analyze(src, TS)).toHaveLength(0);
  });

  it('does not fire on a client that proxies through a backend route', () => {
    const src = `
      export function Chat() {
        const ask = async (p) => fetch('/api/gemini', { method: 'POST', body: p });
        return null;
      }
    `;
    expect(clientSideAiKeyRule.analyze(src, TSX)).toHaveLength(0);
  });
});
