import fs from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';
import type { ValidationIssue } from './types.js';

export function parseDocument(
    raw: string,
    filePath: string
): { ok: true; data: unknown } | { ok: false; issues: ValidationIssue[] } {
    const ext = path.extname(filePath).toLowerCase();
    try {
        if (ext === '.json5') {
            return { ok: true, data: JSON5.parse(raw) };
        }
        try {
            return { ok: true, data: JSON.parse(raw) };
        } catch {
            return { ok: true, data: JSON5.parse(raw) };
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            ok: false,
            issues: [{ code: 'parse', message: `Parse failed for ${filePath}: ${msg}` }]
        };
    }
}

export async function readAndParse(
    filePath: string
): Promise<{ ok: true; data: unknown } | { ok: false; issues: ValidationIssue[] }> {
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        return parseDocument(raw, filePath);
    } catch (e) {
        const err = e as NodeJS.ErrnoException;
        return {
            ok: false,
            issues: [{
                code: 'io',
                message: err.code === 'ENOENT'
                    ? `File not found: ${filePath}`
                    : `Cannot read ${filePath}: ${err.message}`
            }]
        };
    }
}
