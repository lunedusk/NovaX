import { PAGINATOR_LIMITS } from '../limits/discord.js';
import type { AtomicUnit } from '../types/models.js';
import { truncateAtom } from '../utils/text.js';

export interface PackedPage {
    readonly units: readonly AtomicUnit[];
    readonly text: string;
}

export function packAtomicUnits(
    units: readonly AtomicUnit[],
    options: {
        readonly maxChars: number;
        readonly maxUnitsPerPage: number;
        readonly preferUnits: number;
    },
): PackedPage[] {
    const pages: PackedPage[] = [];
    let buf: AtomicUnit[] = [];
    let size = 0;

    const flush = (): void => {
        if (buf.length === 0) return;
        pages.push({
            units: buf,
            text: buf.map((u) => u.text).join('\n'),
        });
        buf = [];
        size = 0;
    };

    for (const raw of units) {
        let unit = raw;
        if (unit.text.length > options.maxChars) {
            unit = { ...unit, text: truncateAtom(unit.text, options.maxChars) };
        }
        const add = unit.text.length + (buf.length > 0 ? 1 : 0);
        const wouldExceedChars = size + add > options.maxChars;
        const wouldExceedCount = buf.length >= options.maxUnitsPerPage;
        const preferFull =
            buf.length >= options.preferUnits && (wouldExceedChars || buf.length >= options.preferUnits);

        if (buf.length > 0 && (wouldExceedChars || wouldExceedCount || preferFull)) {
            flush();
        }

        if (unit.text.length > options.maxChars) {
            pages.push({ units: [unit], text: unit.text });
            continue;
        }

        buf.push(unit);
        size += unit.text.length + (buf.length > 1 ? 1 : 0);

        if (buf.length >= options.maxUnitsPerPage) {
            flush();
        }
    }
    flush();
    return pages;
}

export function defaultPackOptions(mode: 'content' | 'embed' | 'cv2'): {
    maxChars: number;
    maxUnitsPerPage: number;
    preferUnits: number;
} {
    if (mode === 'content') {
        return { maxChars: PAGINATOR_LIMITS.CONTENT_CHARS, maxUnitsPerPage: 15, preferUnits: 8 };
    }
    if (mode === 'embed') {
        return {
            maxChars: Math.min(PAGINATOR_LIMITS.EMBED_DESCRIPTION - 80, 3500),
            maxUnitsPerPage: 12,
            preferUnits: 6,
        };
    }
    return {
        maxChars: PAGINATOR_LIMITS.CV2_TEXT_SAFE - 120,
        maxUnitsPerPage: 12,
        preferUnits: 2,
    };
}
