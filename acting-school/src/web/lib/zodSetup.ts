import { z } from 'zod';

/**
 * Imported first by main.tsx, before any schema is used.
 *
 * zod speeds up object parsing by compiling validators with `new Function` —
 * and first tries whether that is allowed. Under this app's CSP
 * (script-src 'self', no 'unsafe-eval') the try itself is reported as a
 * violation on every page load. `jitless` tells zod not to try: it validates
 * the plain way (same results; these forms are tiny).
 */
z.config({ jitless: true });
