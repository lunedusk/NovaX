import fs from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';
import { getLogger } from '#core/utils/logger.js';
import { deepEqual, type JsonObject, cloneJson } from './mergePreserve.js';

const log = getLogger('Json5Write');

export type WriteMode = 'noop' | 'surgical' | 'wholesale';

async function atomicWriteText(targetPath: string, text: string): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.${Date.now()}.tmp`;
    try {
        await fs.writeFile(tempPath, text, 'utf-8');
        await fs.rename(tempPath, targetPath);
    } catch (error) {
        await fs.unlink(tempPath).catch(() => {});
        throw error;
    }
}

function wholesaleText(data: JsonObject): string {
    return `${JSON5.stringify(data, null, 4)}\n`;
}

function skipWsAndComments(text: string, i: number): number {
    const n = text.length;
    while (i < n) {
        const ch = text[i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            i++;
            continue;
        }
        if (ch === '/' && text[i + 1] === '/') {
            i += 2;
            while (i < n && text[i] !== '\n') i++;
            continue;
        }
        if (ch === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i = Math.min(i + 2, n);
            continue;
        }
        break;
    }
    return i;
}

function matchString(text: string, i: number): number {
    const quote = text[i];
    if (quote !== '"' && quote !== "'") return i;
    i++;
    while (i < text.length) {
        if (text[i] === '\\') {
            i += 2;
            continue;
        }
        if (text[i] === quote) return i + 1;
        i++;
    }
    return text.length;
}

function findMatching(text: string, openIdx: number): number {
    const open = text[openIdx];
    const close = open === '{' ? '}' : open === '[' ? ']' : '';
    if (!close) return -1;
    let depth = 0;
    let i = openIdx;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '"' || ch === "'") {
            i = matchString(text, i);
            continue;
        }
        if (ch === '/' && text[i + 1] === '/') {
            i = skipWsAndComments(text, i);
            continue;
        }
        if (ch === '/' && text[i + 1] === '*') {
            i = skipWsAndComments(text, i);
            continue;
        }
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return i;
        }
        i++;
    }
    return -1;
}

function findKeyValueStart(text: string, objectStart: number, objectEnd: number, key: string): number {
    let i = objectStart + 1;
    while (i < objectEnd) {
        i = skipWsAndComments(text, i);
        if (i >= objectEnd) break;
        if (text[i] === ',' ) {
            i++;
            continue;
        }
        if (text[i] === '"' || text[i] === "'") {
            const keyStart = i;
            const keyEnd = matchString(text, i);
            let parsedKey: string;
            try {
                parsedKey = JSON5.parse(text.slice(keyStart, keyEnd)) as string;
            } catch {
                return -1;
            }
            i = skipWsAndComments(text, keyEnd);
            if (text[i] !== ':') return -1;
            i++;
            i = skipWsAndComments(text, i);
            if (parsedKey === key) return i;
            if (text[i] === '{' || text[i] === '[') {
                const close = findMatching(text, i);
                if (close < 0) return -1;
                i = close + 1;
            } else if (text[i] === '"' || text[i] === "'") {
                i = matchString(text, i);
            } else {
                while (i < objectEnd && text[i] !== ',' && text[i] !== '}') i++;
            }
            continue;
        }
        break;
    }
    return -1;
}

function findObjectRangeForPath(text: string, pathKeys: string[]): { start: number; end: number } | null {
    let i = skipWsAndComments(text, 0);
    if (text[i] !== '{') return null;
    let start = i;
    let end = findMatching(text, start);
    if (end < 0) return null;

    for (const key of pathKeys) {
        const valueStart = findKeyValueStart(text, start, end, key);
        if (valueStart < 0) return null;
        let vs = skipWsAndComments(text, valueStart);
        if (text[vs] !== '{') return null;
        start = vs;
        end = findMatching(text, start);
        if (end < 0) return null;
    }
    return { start, end };
}

function indentOfLine(text: string, index: number): string {
    let lineStart = index;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--;
    let i = lineStart;
    let indent = '';
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
        indent += text[i];
        i++;
    }
    return indent;
}

function objectHasEntries(text: string, start: number, end: number): boolean {
    let i = skipWsAndComments(text, start + 1);
    return i < end;
}

function insertKeyIntoObject(
    text: string,
    objectStart: number,
    objectEnd: number,
    key: string,
    value: unknown,
): string | null {
    const keyJson = JSON5.stringify(key);
    const valueJson = JSON5.stringify(value, null, 4);
    const baseIndent = indentOfLine(text, objectStart);
    const propIndent = `${baseIndent}    `;
    const valueIndented = valueJson
        .split('\n')
        .map((line, idx) => (idx === 0 ? line : `${propIndent}${line}`))
        .join('\n');

    if (!objectHasEntries(text, objectStart, objectEnd)) {
        const insertion = `\n${propIndent}${keyJson}: ${valueIndented}\n${baseIndent}`;
        return text.slice(0, objectEnd) + insertion + text.slice(objectEnd);
    }

    let insertAt = objectEnd;
    let j = objectEnd - 1;
    while (j > objectStart && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n' || text[j] === '\r')) {
        j--;
    }
    const needsComma = text[j] !== ',';
    const comma = needsComma ? ',' : '';
    const insertion = `${comma}\n${propIndent}${keyJson}: ${valueIndented}\n${baseIndent}`;
    return text.slice(0, insertAt) + insertion + text.slice(insertAt);
}

function collectAdditions(
    existing: unknown,
    intended: unknown,
    pathKeys: string[],
    out: Array<{ pathKeys: string[]; key: string; value: unknown }>,
): void {
    if (!isPlainObject(intended)) return;
    const intendedObj = intended as JsonObject;
    const existingObj = isPlainObject(existing) ? (existing as JsonObject) : null;

    for (const key of Object.keys(intendedObj)) {
        const nextPath = [...pathKeys, key];
        if (!existingObj || !Object.prototype.hasOwnProperty.call(existingObj, key)) {
            out.push({ pathKeys, key, value: intendedObj[key] });
            continue;
        }
        if (isPlainObject(intendedObj[key]) && isPlainObject(existingObj[key])) {
            collectAdditions(existingObj[key], intendedObj[key], nextPath, out);
        }
    }
}

function isPlainObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function trySurgicalPatch(
    text: string,
    existing: unknown,
    intended: unknown,
): string | null {
    const additions: Array<{ pathKeys: string[]; key: string; value: unknown }> = [];
    collectAdditions(existing, intended, [], additions);
    if (additions.length === 0) {
        if (deepEqual(existing, intended)) return text;
        return null;
    }

    let current = text;
    const sorted = [...additions].sort((a, b) => a.pathKeys.length - b.pathKeys.length);

    for (const add of sorted) {
        const range = findObjectRangeForPath(current, add.pathKeys);
        if (!range) return null;
        const next = insertKeyIntoObject(current, range.start, range.end, add.key, add.value);
        if (next === null) return null;
        current = next;
    }

    return current;
}

export async function writeJson5Preserving(
    targetPath: string,
    intended: JsonObject,
): Promise<WriteMode> {
    const data = cloneJson(intended);
    let existingText: string | null = null;
    try {
        existingText = await fs.readFile(targetPath, 'utf-8');
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== 'ENOENT') throw error;
    }

    if (existingText === null) {
        await atomicWriteText(targetPath, wholesaleText(data));
        return 'wholesale';
    }

    let existingObj: unknown;
    try {
        existingObj = JSON5.parse(existingText);
    } catch {
        log.warn(`JSON5 surgical write: ${path.basename(targetPath)} unreadable; wholesale rewrite (comments may be lost)`);
        await atomicWriteText(targetPath, wholesaleText(data));
        return 'wholesale';
    }

    if (deepEqual(existingObj, data)) {
        return 'noop';
    }

    const patched = trySurgicalPatch(existingText, existingObj, data);
    if (patched !== null) {
        try {
            const parsed = JSON5.parse(patched);
            if (deepEqual(parsed, data)) {
                await atomicWriteText(targetPath, patched.endsWith('\n') ? patched : `${patched}\n`);
                return 'surgical';
            }
        } catch {
        }
    }

    log.warn(
        `JSON5 surgical write failed for ${path.basename(targetPath)}; falling back to wholesale (comments may be lost)`,
    );
    await atomicWriteText(targetPath, wholesaleText(data));
    return 'wholesale';
}

export async function writeJson5Wholesale(targetPath: string, intended: JsonObject): Promise<void> {
    await atomicWriteText(targetPath, wholesaleText(cloneJson(intended)));
}

export async function persistPlaceholdersInJson5File(
    targetPath: string,
    persists: Map<string, string>,
    intended: JsonObject,
): Promise<WriteMode> {
    if (persists.size === 0) return 'noop';

    let existingText: string;
    try {
        existingText = await fs.readFile(targetPath, 'utf-8');
    } catch {
        await writeJson5Wholesale(targetPath, intended);
        return 'wholesale';
    }

    let next = existingText;
    let changed = false;
    for (const [placeholder, value] of persists) {
        if (next.includes(placeholder)) {
            next = next.split(placeholder).join(value);
            changed = true;
        }
    }

    if (!changed) {
        return writeJson5Preserving(targetPath, intended);
    }

    try {
        const parsed = JSON5.parse(next);
        if (deepEqual(parsed, intended)) {
            await atomicWriteText(targetPath, next.endsWith('\n') ? next : `${next}\n`);
            return 'surgical';
        }
    } catch {
    }

    log.warn(
        `JSON5 placeholder persist failed round-trip for ${path.basename(targetPath)}; wholesale (comments may be lost)`,
    );
    await writeJson5Wholesale(targetPath, intended);
    return 'wholesale';
}
