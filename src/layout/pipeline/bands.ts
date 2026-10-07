/**
 * Generation bands: the vertical layout shared by steps 7 and 8 and the
 * debug geometry.
 *
 * Every generation is one horizontal band. All cards of a generation have
 * their top at the band's top; the band is as tall as its tallest card
 * (LayoutConfig.personHeights, else cardHeight), and verticalGap separates
 * consecutive bands:
 *
 *   top(minGen)  = padding
 *   top(g + 1)   = top(g) + height(g) + verticalGap
 *   height(g)    = max card height of the persons drawn in generation g
 *
 * Without personHeights every band is cardHeight tall, so
 * top(g) = padding + (g - minGen) * (cardHeight + verticalGap).
 */

import { LayoutConfig, PersonId, personCardHeight } from '../../types.js';
import { GenerationalModel, GenerationBand } from './types.js';

export interface GenerationBands {
    /** Bands top to bottom, minGen..maxGen. */
    bands: GenerationBand[];
    /** Band top Y per generation. */
    top: Map<number, number>;
    /** Band height per generation. */
    height: Map<number, number>;
}

/**
 * Compute the band of every generation from minGen to maxGen. Only persons
 * that get a card count towards a band's height: placed (personX) and not a
 * hidden "?" stand-in. A band without such a person is cardHeight tall.
 */
export function computeGenerationBands(
    genModel: Pick<GenerationalModel, 'model' | 'personGen' | 'minGen' | 'maxGen'>,
    personX: ReadonlyMap<PersonId, number>,
    config: Pick<LayoutConfig, 'cardHeight' | 'verticalGap' | 'padding' | 'personHeights'>
): GenerationBands {
    const { model, personGen, minGen, maxGen } = genModel;
    const top = new Map<number, number>();
    const height = new Map<number, number>();
    const bands: GenerationBand[] = [];

    if (!config.personHeights) {
        // Uniform cards: today's formula, bit for bit
        const rowHeight = config.cardHeight + config.verticalGap;
        for (let gen = minGen; gen <= maxGen; gen++) {
            const y = config.padding + (gen - minGen) * rowHeight;
            top.set(gen, y);
            height.set(gen, config.cardHeight);
            bands.push({ generation: gen, top: y, height: config.cardHeight });
        }
        return { bands, top, height };
    }

    const tallest = new Map<number, number>();
    const hidden = model.hiddenPersonIds;
    for (const personId of model.persons.keys()) {
        if (hidden?.has(personId) || !personX.has(personId)) continue;
        const gen = personGen.get(personId);
        if (gen === undefined) continue;
        const h = personCardHeight(config, personId);
        const prev = tallest.get(gen);
        if (prev === undefined || h > prev) tallest.set(gen, h);
    }

    let y = config.padding;
    for (let gen = minGen; gen <= maxGen; gen++) {
        const h = tallest.get(gen) ?? config.cardHeight;
        top.set(gen, y);
        height.set(gen, h);
        bands.push({ generation: gen, top: y, height: h });
        y += h + config.verticalGap;
    }
    return { bands, top, height };
}
