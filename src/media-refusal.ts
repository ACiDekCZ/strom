/**
 * A file the research refused (L3): its bridge answers an upload of the app
 * (`PUT /media/<sha256>`, a batch's file, `POST /batch/<id>/done`,
 * `GET /media/<sha256>`) with `{error, code, text, params}`. A research that
 * says `media.codes` in its `/status.features` gives a stable `code` with its
 * `params`; the app says it in its own language. An unknown code, one without
 * the params its sentence needs, or an older research: the research's own
 * sentence (`error`), as before.
 */

import { strings } from './strings.js';

/** The bridge feature of a research that gives its refusals of files a code (Strom Research beta.8). */
export const MEDIA_CODES_FEATURE = 'media.codes';

/** Whether a research's features (`/status.features`) say its refusals of files carry a code. */
export function mediaCodesOn(features: readonly string[] | null | undefined): boolean {
    return !!features?.includes(MEDIA_CODES_FEATURE);
}

export interface MediaRefusal {
    /** The research's sentence (its language or English), shown when the code is not translated. */
    error: string;
    code: string;
    params: Record<string, string>;
}

/** A refusal's fields from a reply's body (untrusted: trimmed, only strings and numbers in `params`). */
export function parseMediaRefusal(value: unknown): MediaRefusal | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const r = value as Record<string, unknown>;
    const error = typeof r.error === 'string' ? r.error.trim().slice(0, 200)
        : typeof r.why === 'string' ? r.why.trim().slice(0, 200) : '';
    const code = typeof r.code === 'string' && /^[a-z][a-z0-9.-]{0,40}$/.test(r.code) ? r.code : '';
    const params: Record<string, string> = {};
    if (r.params && typeof r.params === 'object' && !Array.isArray(r.params)) {
        for (const [k, v] of Object.entries(r.params as Record<string, unknown>).slice(0, 10)) {
            if (typeof v === 'string') params[k] = v.trim().slice(0, 80);
            else if (typeof v === 'number' && Number.isFinite(v)) params[k] = String(v);
        }
    }
    return error || code ? { error, code, params } : null;
}

/** A count from a param ("120"), or null. */
function count(v: string | undefined): number | null {
    if (v === undefined || !/^\d{1,12}$/.test(v)) return null;
    return Number(v);
}

/**
 * The refusal in the app's language: by its code when the research gives
 * codes (`codes`) and the code is known with the params it needs, else the
 * research's sentence, else `fallback`.
 */
export function mediaRefusalText(value: unknown, codes: boolean, fallback: string): string {
    const r = parseMediaRefusal(value);
    if (!r) return fallback;
    const translated = codes && r.code ? translate(r.code, r.params) : null;
    return translated ?? (r.error || fallback);
}

/** The text of a known code with its params, or null (unknown, a param missing). */
function translate(code: string, p: Record<string, string>): string | null {
    const s = strings.mediaRefusal;
    const need = (v: string | undefined): v is string => !!v;
    switch (code) {
        case 'app.only': return s.appOnly;
        case 'media.bad-sha': return s.badSha;
        case 'media.bad-header': return need(p.header) ? s.badHeader(p.header) : null;
        case 'media.bad-region': return need(p.region) ? s.badRegion(p.region) : null;
        case 'media.no-person': return need(p.person) ? s.noPerson(p.person) : null;
        case 'media.no-source': return need(p.source) ? s.noSource(p.source) : null;
        case 'media.no-shared': return s.noShared;
        case 'media.large': return need(p.mb) ? s.large(p.mb) : null;
        case 'media.full': return s.full;
        case 'media.failed': return s.failed;
        case 'media.sha-differs': return s.shaDiffers;
        case 'media.type': return s.type;
        case 'media.cut-short': return need(p.kind) ? s.cutShort(p.kind) : null;
        case 'media.too-small': { const n = count(p.bytes); return n === null ? null : s.tooSmall(n); }
        case 'media.gone': return s.gone;
        case 'research.busy': return s.busy;
        case 'batch.bad-id': return s.batchBadId;
        case 'batch.zip-alone': return s.zipAlone;
        case 'batch.zip-unreadable': return s.zipUnreadable;
        case 'batch.closed': return s.batchClosed;
        case 'batch.full-files': { const n = count(p.files); return n === null ? null : s.fullFiles(n); }
        case 'batch.full-bytes': return need(p.gb) ? s.fullBytes(p.gb) : null;
        case 'batch.none': return s.batchNone;
        case 'batch.bad-body': return s.batchBadBody;
        // `media.refused`: another reason, told only by the research's sentence. Unknown codes: the list may grow.
        default: return null;
    }
}
