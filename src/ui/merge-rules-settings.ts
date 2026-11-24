/**
 * Settings › Data and privacy › Saved import rules (spec 134 K10.4): the
 * scope and rule remembered per program in the import guide's step 5, one
 * row each with Remove. The row stays hidden while nothing is saved.
 */

import { SettingsManager } from '../settings.js';
import { strings } from '../strings.js';
import { savedRuleDetail } from '../merge/saved-rules.js';

/** Draw the list of saved rules again (the Settings dialog opened, a rule removed). */
export function renderMergeRulesSetting(): void {
    const row = document.getElementById('merge-rules-row');
    const list = row?.querySelector<HTMLElement>('.merge-rules-list');
    if (!row || !list) return;
    const rules = SettingsManager.getMergeRules();
    row.hidden = rules.length === 0;
    const W = strings.mergeWizard;
    list.replaceChildren(...rules.map(({ key, rule }) => {
        const li = document.createElement('li');
        li.className = 'merge-rules-item';
        li.dataset.program = key;
        const text = li.appendChild(document.createElement('span'));
        text.className = 'merge-rules-text';
        const name = text.appendChild(document.createElement('span'));
        name.className = 'merge-rules-program';
        name.textContent = rule.program;
        name.title = rule.program;
        const detail = text.appendChild(document.createElement('span'));
        detail.className = 'merge-rules-detail';
        detail.textContent = savedRuleDetail(rule);
        const remove = li.appendChild(document.createElement('button'));
        remove.type = 'button';
        remove.className = 'secondary merge-rules-remove';
        remove.textContent = W.rulesRemove;
        remove.setAttribute('aria-label', W.rulesRemoveAria(rule.program));
        remove.addEventListener('click', () => {
            const next = li.nextElementSibling?.querySelector<HTMLElement>('.merge-rules-remove')
                ?? li.previousElementSibling?.querySelector<HTMLElement>('.merge-rules-remove');
            const nextKey = (next?.closest('.merge-rules-item') as HTMLElement | null)?.dataset.program;
            SettingsManager.removeMergeRule(key);
            renderMergeRulesSetting();
            // The focus stays in the list (or goes to the dialog's close button once it is empty).
            const again = nextKey ? list.querySelector<HTMLElement>(`.merge-rules-item[data-program="${CSS.escape(nextKey)}"] .merge-rules-remove`) : null;
            (again ?? document.querySelector<HTMLElement>('#settings-modal .close-btn'))?.focus();
        });
        return li;
    }));
}
