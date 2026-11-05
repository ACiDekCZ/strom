/**
 * The help mark "?" (1105 §9): a small outlined round button, always the
 * last item on the right of a heading row (a section's after its count or
 * summary, a window's before its close button). It opens "How Strom works"
 * over whatever is open, right at the place's rule (HELP_TOPICS); closing
 * the help gives the keyboard back to it. Never inside a folding heading's
 * button, a row, a cell or text.
 */

import { strings } from '../strings.js';
import { HELP_TOPICS, type HelpTopic } from '../help/topics.js';
import { isHelpOpen, onHelpClose, openHelp } from './help-ui.js';

/** The topic of the mark whose help is open (a redrawn heading's new mark shows it open too). */
let openTopic: HelpTopic | null = null;

/** Now and Now paused are one heading whose target changes with the state. */
function samePlace(a: HelpTopic, b: HelpTopic): boolean {
    const now = (t: HelpTopic): boolean => t === 'now' || t === 'nowPaused';
    return a === b || (now(a) && now(b));
}

function topicOf(button: HTMLElement): HelpTopic {
    return button.dataset.helpTopic as HelpTopic;
}

/** Point a mark at another topic (Now ↔ Now paused): target, name and tooltip; nothing else changes. */
export function setHelpMarkTopic(button: HTMLButtonElement, topic: HelpTopic): void {
    const h = strings.help;
    const name = h.topics[topic];
    button.dataset.helpTopic = topic;
    button.setAttribute('aria-label', h.mark(name));
    button.title = h.markTitle(name, HELP_TOPICS[topic]);
}

function closed(button: HTMLButtonElement): void {
    const topic = openTopic;
    openTopic = null;
    const open = Array.from(document.querySelectorAll<HTMLButtonElement>('.help-mark[aria-expanded="true"]'));
    for (const b of open) b.setAttribute('aria-expanded', 'false');
    // Its heading was redrawn while the help was open: the keyboard goes to the new mark of the same place.
    if (!button.isConnected && topic) {
        const again = open.find(b => b.isConnected && samePlace(topicOf(b), topic) && b.getClientRects().length > 0);
        again?.focus({ preventScroll: true });
    }
}

/** A help mark for one place of the app (see HELP_TOPICS). */
export function helpMark(topic: HelpTopic): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'help-mark';
    button.textContent = '?';
    button.setAttribute('aria-haspopup', 'dialog');
    setHelpMarkTopic(button, topic);
    button.setAttribute('aria-expanded', openTopic && isHelpOpen() && samePlace(openTopic, topic) ? 'true' : 'false');
    button.addEventListener('click', (e) => {
        // Never folds the section or reaches the window under it.
        e.stopPropagation();
        e.preventDefault();
        if (isHelpOpen()) return;
        const t = topicOf(button);
        openTopic = t;
        button.setAttribute('aria-expanded', 'true');
        const stop = onHelpClose(() => {
            stop();
            closed(button);
        });
        void openHelp(HELP_TOPICS[t], button).then(() => {
            // No help data, or it failed to load: nothing opened.
            if (!isHelpOpen()) {
                stop();
                closed(button);
            }
        });
    });
    return button;
}
