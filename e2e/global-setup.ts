import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';

/**
 * The suite tests its own copy of the build (e2e-dist/strom.html), taken once
 * when the run starts: a build made meanwhile (another task in this checkout)
 * does not change the app under test halfway through.
 */
export default function globalSetup(): void {
    if (!existsSync('strom.html')) throw new Error('strom.html is missing: run `npm run build` first');
    mkdirSync('e2e-dist', { recursive: true });
    copyFileSync('strom.html', 'e2e-dist/strom.html.tmp');
    renameSync('e2e-dist/strom.html.tmp', 'e2e-dist/strom.html');
}
