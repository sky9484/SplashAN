/**
 * Resolve the '@/…' path alias, and extensionless imports, for plain Node.
 *
 * tsconfig maps '@/*' to './*' and the source imports omit extensions, both
 * of which a bundler accepts and `node` does not. Anything that loads
 * application modules outside Next — `npm run doctor`, and tests that import
 * a module which itself imports '@/…' — registers this first.
 *
 * Used two ways:
 *   node --import ./scripts/alias-hook.mjs …    (tests)
 *   import './alias-hook.mjs'                    (doctor, before its imports)
 *
 * It only ever redirects specifiers that resolve to a real file inside the
 * repo; everything else falls through to Node's own resolution, so a package
 * named '@/x' — if one ever existed — would not be shadowed.
 */
import { existsSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.cwd();

/** The order tsc would try, plus the directory index forms. */
const CANDIDATES = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '/index.ts', '/index.tsx'];

function resolveLocal(base) {
  for (const ext of CANDIDATES) {
    const full = base + ext;
    if (!existsSync(full)) continue;
    try {
      if (statSync(full).isFile()) return pathToFileURL(full).href;
    } catch {
      /* keep trying the next candidate */
    }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const url = resolveLocal(path.join(ROOT, specifier.slice(2)));
      if (url) return { url, shortCircuit: true };
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
      const url = resolveLocal(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
      if (url) return { url, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
