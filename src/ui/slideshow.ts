/**
 * Slideshow / TV mode: a full-screen, hands-off flight through the tree for
 * family gatherings — put it on the TV and it plays itself.
 *
 * It glides from person to person (ZoomPan.flyToPerson), pausing on each with a
 * caption: photo, name, years and their story (notes). People with something to
 * show — a photo or a story — are visited first and get a longer stop; the rest
 * still appear so nobody is left out.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings } from '../strings.js';
import { PersonId, Person, STANDALONE_VIEWS } from '../types.js';
import { formatFlexDate } from '../dates.js';
import { uiModule } from './module.js';

/** How long a stop lasts (ms). Stops with a story stay longer to be readable. */
const STOP_PLAIN = 4500;
const STOP_STORY = 8000;
/** Zoom used at a stop — close enough to read the card, wide enough for context. */
const STOP_SCALE = 1.15;
const FLIGHT_MS = 1700;

export const slideshowMethods = uiModule({
    /**
     * Build the stop list from the CURRENTLY VISIBLE people, so the slideshow
     * shows the tree the user is looking at. Ordered oldest-first (a walk down
     * the generations reads like a story), with a stable id tiebreak.
     */
    buildSlideshowStops(): PersonId[] {
        const data = DataManager.getData();
        const visible = [...TreeRenderer.getVisiblePersonIds()]
            .map(id => data.persons[id])
            .filter((p): p is Person => !!p && !p.isPlaceholder);

        const year = (p: Person): number => {
            const m = /^[~<>]?(\d{3,4})/.exec(p.birthDate ?? '');
            return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
        };
        return visible
            .sort((a, b) => year(a) - year(b) || a.id.localeCompare(b.id))
            .map(p => p.id);
    },

    /** Does this person have something worth lingering on? */
    slideshowHasStory(person: Person): boolean {
        return !!(person.notes?.trim() || person.photo);
    },

    async startSlideshow(): Promise<void> {
        // Standalone views (fan/timeline/map) draw into their own container and
        // leave the tree canvas empty — there are no `.person-card` elements to
        // fly to or spotlight, so the show would play over a blank screen. Run
        // it in the Family view instead (real cards + positions) and remember
        // where to return when it ends. Started from family/descendants, the
        // cards already exist, so nothing is switched (slideshowReturnView null).
        this.slideshowReturnView = null;
        const startView = TreeRenderer.getViewMode();
        if (STANDALONE_VIEWS.includes(startView)) {
            this.slideshowReturnView = startView;
            TreeRenderer.presetViewMode('family');
            // The show reads positions/cards from the render — wait for it.
            await TreeRenderer.renderAsync();
            this.showToast(strings.slideshow.runsInFamily);
        }

        const stops = this.buildSlideshowStops();
        if (stops.length < 2) {
            this.showToast(strings.slideshow.needMore);
            this.restoreSlideshowView();
            return;
        }
        this.closeMobileMenu?.();
        this.slideshowStops = stops;
        // Start at the person in focus when possible — that is what the user
        // was looking at, so the show begins where their attention already is.
        const focus = TreeRenderer.getFocusPersonId();
        const at = focus ? stops.indexOf(focus) : -1;
        this.slideshowIndex = at >= 0 ? at : 0;
        this.slideshowPaused = false;
        this.slideshowActive = true;

        document.body.classList.add('slideshow-mode');
        void document.documentElement.requestFullscreen?.().catch(() => { /* not allowed — run windowed */ });
        this.renderSlideshowStop();
    },

    stopSlideshow(): void {
        if (!this.slideshowActive) return;
        this.slideshowActive = false;
        if (this.slideshowTimer) { clearTimeout(this.slideshowTimer); this.slideshowTimer = null; }
        document.body.classList.remove('slideshow-mode');
        document.querySelectorAll('.person-card.slideshow-current')
            .forEach(c => c.classList.remove('slideshow-current'));
        if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => { /* ignore */ });
        // Leave the user where the tour ended, framed as usual.
        const current = this.slideshowStops[this.slideshowIndex];
        if (current) TreeRenderer.setFocus(current);
        // If the show borrowed the Family view from a standalone view, hand it back.
        this.restoreSlideshowView();
    },

    /**
     * Return to the view the slideshow was started from, if it borrowed the
     * Family view (only standalone views set slideshowReturnView). A no-op
     * otherwise, so it is safe to call on every exit path.
     */
    restoreSlideshowView(): void {
        const view = this.slideshowReturnView;
        this.slideshowReturnView = null;
        if (view) TreeRenderer.setViewMode(view);
    },

    /** Fly to the current stop, show its caption and schedule the next one. */
    renderSlideshowStop(): void {
        if (!this.slideshowActive) return;
        const id = this.slideshowStops[this.slideshowIndex];
        const person = id ? DataManager.getPerson(id) : null;
        if (!person) { this.advanceSlideshow(1); return; }

        this.highlightSlideshowCard(id);
        ZoomPan.flyToPerson(id, STOP_SCALE, FLIGHT_MS);
        this.renderSlideshowCaption(person);

        if (this.slideshowTimer) clearTimeout(this.slideshowTimer);
        if (this.slideshowPaused) return;
        const hold = (this.slideshowHasStory(person) ? STOP_STORY : STOP_PLAIN) + FLIGHT_MS;
        this.slideshowTimer = window.setTimeout(() => this.advanceSlideshow(1), hold);
    },

    /** Spotlight the card at the current stop; everything else dims back. */
    highlightSlideshowCard(personId: PersonId): void {
        document.querySelectorAll('.person-card.slideshow-current')
            .forEach(c => c.classList.remove('slideshow-current'));
        document.querySelector(`.person-card[data-id="${personId}"]`)
            ?.classList.add('slideshow-current');
    },

    renderSlideshowCaption(person: Person): void {
        const box = document.getElementById('slideshow-caption');
        if (!box) return;
        const name = `${person.firstName} ${person.lastName}`.trim() || '?';
        const years = [person.birthDate, person.deathDate]
            .map(d => (d ? formatFlexDate(d) : ''))
            .filter(Boolean).join(' – ');
        const story = person.notes?.trim() ?? '';
        box.innerHTML = `
            ${person.photo ? `<div class="slideshow-photo"><img src="${person.photo}" alt=""></div>` : ''}
            <div class="slideshow-text">
                <div class="slideshow-name">${this.escapeHtml(name)}</div>
                ${years ? `<div class="slideshow-years">${this.escapeHtml(years)}</div>` : ''}
                ${story ? `<div class="slideshow-story">${this.escapeHtml(story)}</div>` : ''}
            </div>
            <div class="slideshow-progress">${this.slideshowIndex + 1} / ${this.slideshowStops.length}</div>`;
    },

    /** Move `delta` stops and restart the timer; wraps around at the ends. */
    advanceSlideshow(delta: number): void {
        if (!this.slideshowActive) return;
        const n = this.slideshowStops.length;
        this.slideshowIndex = ((this.slideshowIndex + delta) % n + n) % n;
        this.renderSlideshowStop();
    },

    toggleSlideshowPause(): void {
        if (!this.slideshowActive) return;
        this.slideshowPaused = !this.slideshowPaused;
        document.body.classList.toggle('slideshow-paused', this.slideshowPaused);
        if (this.slideshowPaused) {
            if (this.slideshowTimer) { clearTimeout(this.slideshowTimer); this.slideshowTimer = null; }
        } else {
            this.renderSlideshowStop();
        }
    },
});
