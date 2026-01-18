/**
 * Generate SVG string from LayoutResult for snapshot testing.
 * Deterministic output for reliable comparisons.
 */

import { StromData, DEFAULT_LAYOUT_CONFIG } from '../../../types.js';
import { LayoutResult } from '../../pipeline/types.js';

interface SvgOptions {
    cardWidth?: number;
    cardHeight?: number;
    showLabels?: boolean;  // Show person names on cards
}

export function generateSvg(
    result: LayoutResult,
    data: StromData,
    options: SvgOptions = {}
): string {
    const cardWidth = options.cardWidth ?? DEFAULT_LAYOUT_CONFIG.cardWidth;
    const cardHeight = options.cardHeight ?? DEFAULT_LAYOUT_CONFIG.cardHeight;
    const showLabels = options.showLabels ?? true;

    // Calculate SVG bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pos of result.positions.values()) {
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + cardWidth);
        maxY = Math.max(maxY, pos.y + cardHeight);
    }

    const padding = 20;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;
    const offsetX = -minX + padding;
    const offsetY = -minY + padding;

    const lines: string[] = [];
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`);
    lines.push(`  <g transform="translate(${offsetX}, ${offsetY})">`);

    // 1. Spouse lines (dashed)
    lines.push('    <!-- Spouse lines -->');
    for (const sl of result.spouseLines) {
        lines.push(`    <line x1="${sl.xMin}" y1="${sl.y}" x2="${sl.xMax}" y2="${sl.y}" stroke="#666" stroke-dasharray="4,2"/>`);
    }

    // 2. Parent-child connections (bus routing)
    lines.push('    <!-- Connections -->');
    for (const conn of result.connections) {
        // Stem (vertical from parent to connector)
        lines.push(`    <line x1="${conn.stemX}" y1="${conn.stemTopY}" x2="${conn.stemX}" y2="${conn.stemBottomY}" stroke="#333"/>`);

        // Connector (horizontal if needed)
        if (conn.connectorFromX !== conn.connectorToX) {
            lines.push(`    <line x1="${conn.connectorFromX}" y1="${conn.connectorY}" x2="${conn.connectorToX}" y2="${conn.connectorY}" stroke="#333"/>`);
        }

        // Vertical to bus (if connector Y != branch Y)
        if (Math.abs(conn.connectorY - conn.branchY) > 0.5) {
            lines.push(`    <line x1="${conn.connectorToX}" y1="${conn.connectorY}" x2="${conn.connectorToX}" y2="${conn.branchY}" stroke="#333"/>`);
        }

        // Bus (horizontal branch)
        lines.push(`    <line x1="${conn.branchLeftX}" y1="${conn.branchY}" x2="${conn.branchRightX}" y2="${conn.branchY}" stroke="#333"/>`);

        // Drops (vertical to each child)
        for (const drop of conn.drops) {
            lines.push(`    <line x1="${drop.x}" y1="${conn.branchY}" x2="${drop.x}" y2="${drop.bottomY}" stroke="#333"/>`);
        }
    }

    // 3. Person cards (sorted by ID for determinism)
    lines.push('    <!-- Cards -->');
    const sortedPositions = [...result.positions.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [personId, pos] of sortedPositions) {
        const person = data.persons[personId];
        const name = person ? `${person.firstName} ${person.lastName}` : personId;
        const fill = person?.gender === 'male' ? '#e3f2fd' : '#fce4ec';

        lines.push(`    <rect x="${pos.x}" y="${pos.y}" width="${cardWidth}" height="${cardHeight}" fill="${fill}" stroke="#999"/>`);
        if (showLabels) {
            const textY = pos.y + cardHeight / 2 + 4;
            lines.push(`    <text x="${pos.x + cardWidth / 2}" y="${textY}" text-anchor="middle" font-size="10">${escapeXml(name)}</text>`);
        }
    }

    lines.push('  </g>');
    lines.push('</svg>');

    return lines.join('\n');
}

function escapeXml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
