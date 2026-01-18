/**
 * Debug Overlay - SVG Visualization
 *
 * Renders debug geometry as SVG elements overlaid on the tree.
 */

import { DebugGeometry } from './layout/pipeline/debug-types.js';

/** Debug overlay colors */
const COLORS = {
    personBox: '#4CAF50',       // Green
    unionBox: '#2196F3',        // Blue
    siblingSpan: '#FF9800',     // Orange
    busLine: '#9C27B0',         // Purple
    anchorPoint: '#F44336',     // Red
    genBandEven: 'rgba(0,0,0,0.03)',
    genBandOdd: 'rgba(0,0,0,0.06)',
    clusterCard: '#E91E63',     // Pink - card extent
    clusterBlock: '#00BCD4'     // Cyan - block extent
};

/**
 * Clear any existing debug overlay elements from SVG.
 */
export function clearDebugOverlay(svg: SVGSVGElement): void {
    svg.querySelectorAll('.debug-overlay').forEach(el => el.remove());
}

/**
 * Render debug geometry as SVG overlay.
 */
export function renderDebugOverlay(
    svg: SVGSVGElement,
    geometry: DebugGeometry
): void {
    // Clear existing
    clearDebugOverlay(svg);

    // Create a group for all debug elements
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('debug-overlay');

    // Render in order: bands (background), branches, spans, boxes, lines, points (foreground)
    renderGenerationBands(group, geometry);
    // renderSiblingFamilyClusters(group, geometry);  // Disabled - was for SFC debugging
    // renderBranchEnvelopes(group, geometry);  // Disabled - too cluttered
    renderSiblingSpans(group, geometry);
    renderUnionBoxes(group, geometry);
    renderPersonBoxes(group, geometry);
    renderBusLines(group, geometry);
    renderAnchorPoints(group, geometry);

    svg.appendChild(group);
}

/**
 * Render generation bands as background stripes.
 */
function renderGenerationBands(group: SVGGElement, geometry: DebugGeometry): void {
    // Get total width from person boxes
    let maxX = 500;
    for (const box of geometry.personBoxes) {
        maxX = Math.max(maxX, box.x + box.width + 100);
    }

    for (const band of geometry.generationBands) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', '0');
        rect.setAttribute('y', String(band.y));
        rect.setAttribute('width', String(maxX));
        rect.setAttribute('height', String(band.height));
        rect.setAttribute('fill', band.gen % 2 === 0 ? COLORS.genBandEven : COLORS.genBandOdd);
        rect.setAttribute('stroke', 'none');
        group.appendChild(rect);

        // Generation label
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', '10');
        text.setAttribute('y', String(band.y + band.height / 2 + 4));
        text.setAttribute('fill', '#999');
        text.setAttribute('font-size', '11');
        text.setAttribute('font-family', 'monospace');
        text.textContent = `Gen ${band.gen}`;
        group.appendChild(text);
    }
}

/**
 * Render branch envelopes as semi-transparent colored rectangles.
 */
function renderBranchEnvelopes(group: SVGGElement, geometry: DebugGeometry): void {
    if (!geometry.branchEnvelopes) return;

    for (const env of geometry.branchEnvelopes) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(env.minX));
        rect.setAttribute('y', String(env.minY));
        rect.setAttribute('width', String(env.maxX - env.minX));
        rect.setAttribute('height', String(env.maxY - env.minY));
        rect.setAttribute('fill', env.color);
        rect.setAttribute('stroke', env.color.replace('0.15', '0.6'));
        rect.setAttribute('stroke-width', '1.5');
        rect.setAttribute('stroke-dasharray', '6,3');
        group.appendChild(rect);

        // Label
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(env.minX + 4));
        text.setAttribute('y', String(env.minY + 12));
        text.setAttribute('fill', env.color.replace('0.15', '0.8'));
        text.setAttribute('font-size', '10');
        text.setAttribute('font-family', 'monospace');
        text.textContent = env.label;
        group.appendChild(text);
    }
}

/**
 * Render sibling family clusters as colored rectangles.
 * Shows both card extent (pink, solid) and block extent (cyan, dashed).
 */
function renderSiblingFamilyClusters(group: SVGGElement, geometry: DebugGeometry): void {
    if (!geometry.siblingFamilyClusters) return;

    for (const cluster of geometry.siblingFamilyClusters) {
        // Block extent (cyan, dashed) - shows measured width including children centering
        const blockRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        blockRect.setAttribute('x', String(cluster.blockMinX));
        blockRect.setAttribute('y', String(cluster.minY - 15));
        blockRect.setAttribute('width', String(cluster.blockMaxX - cluster.blockMinX));
        blockRect.setAttribute('height', String(cluster.maxY - cluster.minY + 30));
        blockRect.setAttribute('fill', 'none');
        blockRect.setAttribute('stroke', COLORS.clusterBlock);
        blockRect.setAttribute('stroke-width', '2');
        blockRect.setAttribute('stroke-dasharray', '8,4');
        blockRect.setAttribute('opacity', '0.7');
        group.appendChild(blockRect);

        // Card extent (pink, solid) - shows actual card positions
        const cardRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        cardRect.setAttribute('x', String(cluster.cardMinX));
        cardRect.setAttribute('y', String(cluster.minY - 10));
        cardRect.setAttribute('width', String(cluster.cardMaxX - cluster.cardMinX));
        cardRect.setAttribute('height', String(cluster.maxY - cluster.minY + 20));
        cardRect.setAttribute('fill', cluster.color);
        cardRect.setAttribute('stroke', COLORS.clusterCard);
        cardRect.setAttribute('stroke-width', '2');
        cardRect.setAttribute('opacity', '0.8');
        group.appendChild(cardRect);

        // Label
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(cluster.cardMinX + 4));
        text.setAttribute('y', String(cluster.minY - 18));
        text.setAttribute('fill', COLORS.clusterCard);
        text.setAttribute('font-size', '11');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('font-family', 'sans-serif');
        text.textContent = cluster.label;
        group.appendChild(text);

        // Gap indicator between card and block extents
        const leftGap = cluster.cardMinX - cluster.blockMinX;
        const rightGap = cluster.blockMaxX - cluster.cardMaxX;
        if (leftGap > 5 || rightGap > 5) {
            const gapText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            gapText.setAttribute('x', String(cluster.blockMinX + 4));
            gapText.setAttribute('y', String(cluster.maxY + 25));
            gapText.setAttribute('fill', COLORS.clusterBlock);
            gapText.setAttribute('font-size', '9');
            gapText.setAttribute('font-family', 'monospace');
            gapText.textContent = `block: +${leftGap.toFixed(0)}L +${rightGap.toFixed(0)}R`;
            group.appendChild(gapText);
        }
    }
}

/**
 * Render person boxes as green rectangles.
 */
function renderPersonBoxes(group: SVGGElement, geometry: DebugGeometry): void {
    for (const box of geometry.personBoxes) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(box.x));
        rect.setAttribute('y', String(box.y));
        rect.setAttribute('width', String(box.width));
        rect.setAttribute('height', String(box.height));
        rect.setAttribute('fill', 'none');
        rect.setAttribute('stroke', COLORS.personBox);
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('opacity', '0.8');
        group.appendChild(rect);
    }
}

/**
 * Render union boxes as blue dashed rectangles.
 */
function renderUnionBoxes(group: SVGGElement, geometry: DebugGeometry): void {
    for (const box of geometry.unionBoxes) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(box.x));
        rect.setAttribute('y', String(box.y));
        rect.setAttribute('width', String(box.width));
        rect.setAttribute('height', String(box.height));
        rect.setAttribute('fill', 'none');
        rect.setAttribute('stroke', COLORS.unionBox);
        rect.setAttribute('stroke-width', '1.5');
        rect.setAttribute('stroke-dasharray', '4,2');
        rect.setAttribute('opacity', '0.7');
        group.appendChild(rect);
    }
}

/**
 * Render sibling spans as orange brackets below children.
 */
function renderSiblingSpans(group: SVGGElement, geometry: DebugGeometry): void {
    for (const span of geometry.siblingSpans) {
        // Horizontal line
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(span.x1));
        line.setAttribute('y1', String(span.y));
        line.setAttribute('x2', String(span.x2));
        line.setAttribute('y2', String(span.y));
        line.setAttribute('stroke', COLORS.siblingSpan);
        line.setAttribute('stroke-width', '2');
        line.setAttribute('opacity', '0.7');
        group.appendChild(line);

        // Left bracket end
        const leftEnd = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        leftEnd.setAttribute('x1', String(span.x1));
        leftEnd.setAttribute('y1', String(span.y - 4));
        leftEnd.setAttribute('x2', String(span.x1));
        leftEnd.setAttribute('y2', String(span.y + 4));
        leftEnd.setAttribute('stroke', COLORS.siblingSpan);
        leftEnd.setAttribute('stroke-width', '2');
        leftEnd.setAttribute('opacity', '0.7');
        group.appendChild(leftEnd);

        // Right bracket end
        const rightEnd = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        rightEnd.setAttribute('x1', String(span.x2));
        rightEnd.setAttribute('y1', String(span.y - 4));
        rightEnd.setAttribute('x2', String(span.x2));
        rightEnd.setAttribute('y2', String(span.y + 4));
        rightEnd.setAttribute('stroke', COLORS.siblingSpan);
        rightEnd.setAttribute('stroke-width', '2');
        rightEnd.setAttribute('opacity', '0.7');
        group.appendChild(rightEnd);
    }
}

/**
 * Render bus lines as purple dashed lines.
 */
function renderBusLines(group: SVGGElement, geometry: DebugGeometry): void {
    for (const bus of geometry.busLines) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(bus.x1 - 10));
        line.setAttribute('y1', String(bus.y));
        line.setAttribute('x2', String(bus.x2 + 10));
        line.setAttribute('y2', String(bus.y));
        line.setAttribute('stroke', COLORS.busLine);
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-dasharray', '6,3');
        line.setAttribute('opacity', '0.6');
        group.appendChild(line);
    }
}

/**
 * Render anchor points as colored dots.
 */
function renderAnchorPoints(group: SVGGElement, geometry: DebugGeometry): void {
    for (const point of geometry.anchorPoints) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(point.x));
        circle.setAttribute('cy', String(point.y));

        let color = COLORS.anchorPoint;
        let radius = 4;

        switch (point.type) {
            case 'person':
                // Skip person centers - too cluttered
                continue;
            case 'union':
                color = COLORS.unionBox;
                radius = 5;
                break;
            case 'bus':
                color = COLORS.busLine;
                radius = 4;
                break;
        }

        circle.setAttribute('r', String(radius));
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', '1');
        circle.setAttribute('opacity', '0.9');
        group.appendChild(circle);
    }
}
