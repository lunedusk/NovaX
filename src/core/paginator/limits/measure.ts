import { PAGINATOR_LIMITS } from './discord.js';
import type { PagePayload } from '../types/models.js';

export function measureContentChars(text: string): number {
    return text.length;
}

export function measureEmbedTotal(embeds: ReadonlyArray<{ data?: { title?: string | null; description?: string | null; fields?: ReadonlyArray<{ name: string; value: string }>; footer?: { text?: string | null }; author?: { name?: string | null } } }>): number {
    let total = 0;
    for (const e of embeds) {
        const d = e.data ?? (e as { title?: string; description?: string });
        const title = 'title' in d ? d.title : undefined;
        const description = 'description' in d ? d.description : undefined;
        if (title) total += String(title).length;
        if (description) total += String(description).length;
        const fields = 'fields' in d && Array.isArray(d.fields) ? d.fields : [];
        for (const f of fields) {
            total += f.name.length + f.value.length;
        }
    }
    return total;
}

export function measureCv2TextFromStrings(parts: readonly string[]): number {
    return parts.reduce((n, s) => n + s.length, 0);
}

export function isUnderBudget(payload: PagePayload): boolean {
    if (payload.mode === 'content') {
        return measureContentChars(payload.content) <= PAGINATOR_LIMITS.CONTENT_CHARS;
    }
    if (payload.mode === 'embed') {
        return measureEmbedTotal(payload.embeds) <= PAGINATOR_LIMITS.EMBED_TOTAL_CHARS;
    }
    if (payload.mode === 'cv2') {
        return measureCv2TextFromStrings(payload.textParts) <= PAGINATOR_LIMITS.CV2_TEXT_SAFE;
    }
    return true;
}
