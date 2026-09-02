/**
 * Copy the titler's model into `public/assets/titler/` before a build or a serve.
 *
 * Why not an `assets` glob in angular.json, which is what this replaces: with pnpm,
 * `node_modules/@aparte/titler-efigsp` is a SYMLINK into `node_modules/.pnpm/`. The
 * glob resolved it on Windows, where pnpm uses junctions that behave like real
 * directories, and produced nothing on Linux — silently, with no warning, so the
 * build stayed green and the deployed site answered 404 on the model. The titler then
 * fails to load and titles fall back to the library's truncation, which is a
 * degradation nobody sees.
 *
 * `createRequire().resolve()` follows the symlink the way Node does, so the source
 * path is real on every platform. The package exports its model as a subpath
 * (`"./model"`), which is the supported way to ask for the file rather than guessing
 * at its location.
 */
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const require = createRequire(import.meta.url);

const source = require.resolve('@aparte/titler-efigsp/model');
const directory = join('public', 'assets', 'titler');
const destination = join(directory, basename(source));

mkdirSync(directory, { recursive: true });
copyFileSync(source, destination);

console.log(`[titler] ${basename(source)} -> ${destination}`);
