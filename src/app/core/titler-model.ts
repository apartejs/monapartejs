/**
 * The titler's model file, as scripts/copy-titler-model.mjs copies it to `assets/titler/`
 * (under the name the package gives it). Named here rather than read from the package,
 * whose model path cannot be imported in the browser (see TitlerService `load()`).
 *
 * A version that renames its model (1.2: `titler-v1.2-…`) would 404 here, and in
 * production the titler then falls back to the library's truncation without a word:
 * titler-model.spec.ts holds this name to the package's.
 */
export const MODEL_FILE = 'titler-v1.2-efigsp-int3.bin';
