/**
 * FCG020 — Gemini API key reachable from the browser
 *
 * The raw Gemini SDK (`@google/generative-ai`) authenticates with a plain API
 * key. Shipped in client code, that key is in the JavaScript bundle and can be
 * scraped and used by anyone. Reported losses run from $15k to $128k within
 * hours, and inference is billed per token, so there is no natural ceiling.
 *
 *   const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY);
 *
 * `NEXT_PUBLIC_*`, `VITE_*` and `REACT_APP_*` are inlined into the bundle by
 * design — the prefix is the bundler's contract that the value is public. A key
 * behind one is exposed no matter what the file extension is.
 *
 * Two things this rule deliberately does NOT flag:
 *
 * 1. `firebase/ai` (Firebase AI Logic). That SDK is *designed* for client use:
 *    it carries no raw key and is protected by App Check. Flagging it would
 *    punish the pattern Firebase actively recommends.
 *
 * 2. `apiKey: 'AIza...'` in a `firebaseConfig` object. Firebase documents the
 *    web API key as not-a-secret and expects it in client code. Flagging it
 *    would fire on essentially every Firebase app ever written. This rule only
 *    reacts to a key handed to the AI SDK.
 *
 * Server-side use of the raw SDK is correct and is left alone — a file that
 * imports firebase-functions/firebase-admin or defines onCall/onRequest is
 * treated as backend.
 */

import { Project, SyntaxKind, SourceFile } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

const RAW_SDK_RE      = /@google\/generative-ai|\bGoogleGenerativeAI\b/;
// Bundler-inlined prefixes: the value ships to the browser.
const CLIENT_ENV_RE   = /(process\.env\.(NEXT_PUBLIC_|REACT_APP_)\w+|import\.meta\.env\.VITE_\w+)/;
const HARDCODED_KEY_RE = /['"`]AIza[\w-]{10,}['"`]/;
const BACKEND_RE      = /firebase-functions|firebase-admin|\bonCall\s*[(<]|\bonRequest\s*[(<]|\bonDocument\w+\s*[(<]/;
const REACT_RE        = /from\s+['"]react['"]|['"]use client['"]/;

export const clientSideAiKeyRule: Rule = {
  id: 'FCG020',

  analyze(sourceText: string, filePath: string, sharedSf?: SourceFile): RuleDiagnostic[] {
    if (!RAW_SDK_RE.test(sourceText)) return [];
    if (BACKEND_RE.test(sourceText)) return [];

    const isClientFile = /\.(tsx|jsx)$/.test(filePath) || REACT_RE.test(sourceText);

    let sf: SourceFile;
    if (sharedSf) {
      sf = sharedSf;
    } else {
      const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true, compilerOptions: { allowJs: true, jsx: 4 } });
      sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    }
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.NewExpression).forEach(expr => {
      if (expr.getExpression().getText() !== 'GoogleGenerativeAI') return;

      const argText = expr.getArguments().map(a => a.getText()).join(', ');
      const envMatch = CLIENT_ENV_RE.exec(argText);
      const hardcoded = HARDCODED_KEY_RE.test(argText);

      // Fire when the key is provably public, or the file is provably client-side.
      if (!envMatch && !hardcoded && !isClientFile) return;

      const source = envMatch
        ? `\`${envMatch[1]}\` — that prefix tells the bundler to inline the value into the browser bundle`
        : hardcoded
          ? 'a hardcoded API key, which is committed to your repository and shipped in the bundle'
          : 'an API key in client-side code, where it ships in the browser bundle';

      const pos = expr.getExpression().getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);

      diagnostics.push({
        message:
          `[FCG020] The Gemini SDK is being constructed with ${source}. ` +
          `Anyone can read it from your site and bill Gemini inference to your project — reported thefts have ` +
          `reached five figures within hours, and token-billed inference has no natural ceiling. ` +
          `Fix: move the SDK call behind a backend endpoint (a callable function or API route) so the key stays ` +
          `on the server, or switch to Firebase AI Logic (\`firebase/ai\`), which is built for client use and ` +
          `is protected by App Check instead of a raw key.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + 'GoogleGenerativeAI'.length,
        severity: 'error',
        code: 'FCG020'
      });
    });

    return diagnostics;
  }
};
