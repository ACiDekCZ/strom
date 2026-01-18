/**
 * Load test fixtures from the test/ directory.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { StromData } from '../../../types.js';

/**
 * Load a JSON fixture file by name (without .json extension).
 */
export function loadFixture(name: string): StromData {
    const fixturePath = join(process.cwd(), 'test', `${name}.json`);
    const content = readFileSync(fixturePath, 'utf-8');
    return JSON.parse(content) as StromData;
}
