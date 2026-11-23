/**
 * Step 6 – What happened (spec 134 §9, part C). In part A the write ends as
 * today (Manage trees and the offer to switch to the new tree), so this body
 * is only a stand-in.
 */

import type { StepContext } from './context.js';
import { stepHeading } from './context.js';

export function renderStep6(host: HTMLElement, _ctx: StepContext): void {
    host.innerHTML = stepHeading(6);
}
