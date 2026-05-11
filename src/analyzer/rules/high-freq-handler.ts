/**
 * FCG011 — Expensive operation inside a high-frequency event handler
 *
 * scroll, mousemove, resize, keydown, input, wheel, touchmove fire tens to
 * hundreds of times per second. Calling getDoc(), fetch(), or axios inside
 * one of these handlers — without debounce or throttle — can generate
 * thousands of billed operations per minute of user interaction.
 *
 * Detected patterns:
 *   element.addEventListener('scroll', handler)   ← DOM addEventListener
 *   <div onScroll={handler} />                    ← React JSX prop
 *
 * Safe if the handler is wrapped in debounce() or throttle() from lodash or
 * any utility — those wrappers are the correct fix.
 */

import { Project, SyntaxKind } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

const HIGH_FREQ_EVENTS = new Set([
  'scroll', 'mousemove', 'pointermove', 'touchmove',
  'resize', 'wheel',
  'keydown', 'keyup', 'keypress',
  'input', 'compositionupdate',
]);

// JSX prop names that correspond to high-frequency events
const HIGH_FREQ_JSX_PROPS = new Set([
  'onScroll', 'onMouseMove', 'onPointerMove', 'onTouchMove',
  'onWheel', 'onKeyDown', 'onKeyUp', 'onKeyPress',
  'onInput',
]);

const EXPENSIVE_OP_RE = /\b(getDoc|getDocs|onSnapshot|fetch|axios)\s*[.(]/;
const DEBOUNCE_RE = /\b(debounce|throttle)\s*\(/;

export const highFreqHandlerRule: Rule = {
  id: 'FCG011',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
    const hasExpensive = EXPENSIVE_OP_RE.test(sourceText);
    if (!hasExpensive) return [];

    const project = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: 4 }
    });
    const sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    const diagnostics: RuleDiagnostic[] = [];

    // ── Pattern 1: element.addEventListener('scroll', fn) ────────────────────

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const expr = call.getExpression();
      if (!expr.getText().endsWith('addEventListener')) return;

      const args = call.getArguments();
      if (args.length < 2) return;

      // First arg must be a string literal naming a high-freq event
      const eventArg = args[0];
      if (eventArg.getKind() !== SyntaxKind.StringLiteral) return;
      const eventName = eventArg.getText().replace(/['"]/g, '');
      if (!HIGH_FREQ_EVENTS.has(eventName)) return;

      // Second arg is the handler — get its text
      const handlerArg = args[1];
      const handlerText = handlerArg.getText();

      // Safe if wrapped in debounce/throttle
      if (DEBOUNCE_RE.test(handlerText)) return;

      // Resolve inline functions and named references
      let bodyText = handlerText;
      if (
        handlerArg.getKind() === SyntaxKind.Identifier
      ) {
        // Named handler — try to find its definition in the same file
        const name = handlerText;
        const decl = sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)
          .find(v => v.getName() === name);
        bodyText = decl?.getInitializer()?.getText() ?? handlerText;
      }

      if (!EXPENSIVE_OP_RE.test(bodyText)) return;

      const opMatch = EXPENSIVE_OP_RE.exec(bodyText);
      const op = opMatch?.[1] ?? 'an expensive operation';

      const pos = expr.getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);
      const name = expr.getText();

      diagnostics.push({
        message:
          `[FCG011] ${op}() inside a '${eventName}' handler fires on every ${eventName} event ` +
          `(up to hundreds of times/second) — no debounce or throttle detected. ` +
          `This can generate thousands of billed reads per minute of user interaction. ` +
          `Fix: wrap the handler in debounce(handler, 300) or throttle(handler, 500).`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + name.length,
        severity: 'error',
        code: 'FCG011'
      });
    });

    // ── Pattern 2: JSX high-frequency props (onScroll, onMouseMove, etc.) ───

    sf.getDescendantsOfKind(SyntaxKind.JsxAttribute).forEach(attr => {
      const attrName = attr.getNameNode().getText();
      if (!HIGH_FREQ_JSX_PROPS.has(attrName)) return;

      const initializer = attr.getInitializer();
      if (!initializer) return;

      const handlerText = initializer.getText();

      // Safe if wrapped in debounce/throttle
      if (DEBOUNCE_RE.test(handlerText)) return;

      // Resolve named handler references
      let bodyText = handlerText;
      const inner = initializer.getFirstChildByKind(SyntaxKind.Identifier);
      if (inner) {
        const name = inner.getText();
        const decl = sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)
          .find(v => v.getName() === name);
        bodyText = decl?.getInitializer()?.getText() ?? handlerText;
      }

      if (!EXPENSIVE_OP_RE.test(bodyText)) return;

      const opMatch = EXPENSIVE_OP_RE.exec(bodyText);
      const op = opMatch?.[1] ?? 'an expensive operation';

      const eventLabel = attrName.replace(/^on/, '').toLowerCase();

      const pos = attr.getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);

      diagnostics.push({
        message:
          `[FCG011] ${op}() wired to ${attrName} fires on every ${eventLabel} event ` +
          `without debounce or throttle — can generate hundreds of billed reads per second. ` +
          `Fix: wrap the handler in debounce(handler, 300) or throttle(handler, 500).`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + attrName.length,
        severity: 'error',
        code: 'FCG011'
      });
    });

    return diagnostics;
  }
};
