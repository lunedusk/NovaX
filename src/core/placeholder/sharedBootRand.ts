import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const BOOT_SHARED_ENV_KEY = 'ZENE_BOOT_SHARED_RAND';

const SHARED_PLACEHOLDER_RE = /\$\{rand:([^}]*@shared[^}]*)\}/g;

export type SharedRandSpec = {
    encoding: string;
    length: number;
    name: string;
};

export function isShardWorkerProcess(): boolean {
    return process.env.SHARD_LIST !== undefined || typeof process.send === 'function';
}

export function isShardingManagerProcess(): boolean {
    return process.env.SHARD_LIST === undefined && typeof process.send !== 'function';
}

function mapKey(spec: SharedRandSpec): string {
    return `${spec.name}:${spec.encoding}:${spec.length}`;
}

function generate(encoding: string, byteLength: number): string {
    const n = Math.max(1, Math.min(byteLength, 1024));
    const buf = randomBytes(n);
    if (encoding === 'base64') return buf.toString('base64');
    if (encoding === 'base64url') return buf.toString('base64url');
    return buf.toString('hex');
}

export function parseSharedRandBody(body: string): SharedRandSpec | null {
    const atIdx = body.indexOf('@shared');
    if (atIdx < 0) return null;

    const before = body.slice(0, atIdx);
    const after = body.slice(atIdx + '@shared'.length);
    if (after.length > 0 && !after.startsWith(':') && after[0] !== '') {
        if (after[0] !== ':') return null;
    }

    let name = '_';
    if (after.startsWith(':')) {
        const rest = after.slice(1);
        if (rest.includes('#') || rest.includes('@')) return null;
        name = rest.length > 0 ? rest : '_';
    } else if (after.length > 0) {
        return null;
    }

    const parts = before.split(':').filter((p) => p.length > 0);
    if (parts.length < 2) return null;
    const encoding = parts[0].toLowerCase();
    const length = parseInt(parts[1], 10);
    if (!Number.isFinite(length) || length <= 0) return null;

    return { encoding, length, name };
}

let memoryMap: Map<string, string> | null = null;
const emittedValues = new Set<string>();

function loadEnvMap(): Map<string, string> {
    if (memoryMap) return memoryMap;
    memoryMap = new Map();
    const raw = process.env[BOOT_SHARED_ENV_KEY];
    if (!raw) return memoryMap;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
                if (typeof v === 'string') {
                    memoryMap.set(k, v);
                    emittedValues.add(v);
                }
            }
        }
    } catch {
        memoryMap = new Map();
    }
    return memoryMap;
}

function persistEnvMap(map: Map<string, string>): void {
    const obj: Record<string, string> = {};
    for (const [k, v] of map) obj[k] = v;
    process.env[BOOT_SHARED_ENV_KEY] = JSON.stringify(obj);
}

export function isSharedBootValue(value: string): boolean {
    loadEnvMap();
    return emittedValues.has(value);
}

export function resolveSharedBootRand(spec: SharedRandSpec): string {
    const key = mapKey(spec);
    const map = loadEnvMap();
    const existing = map.get(key);
    if (existing !== undefined) {
        emittedValues.add(existing);
        return existing;
    }

    if (isShardWorkerProcess()) {
        throw new Error(
            `Shared boot rand missing for key "${key}". Shard workers must receive ${BOOT_SHARED_ENV_KEY} from the ShardingManager and must never generate @shared values locally.`,
        );
    }

    const value = generate(spec.encoding, spec.length);
    map.set(key, value);
    emittedValues.add(value);
    persistEnvMap(map);
    return value;
}

export function ensureSharedKey(spec: SharedRandSpec): string {
    return resolveSharedBootRand(spec);
}

function collectSpecsFromText(text: string, into: Map<string, SharedRandSpec>): void {
    SHARED_PLACEHOLDER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SHARED_PLACEHOLDER_RE.exec(text)) !== null) {
        const spec = parseSharedRandBody(match[1]);
        if (spec) into.set(mapKey(spec), spec);
    }
}

function walkFilesForShared(dir: string, into: Map<string, SharedRandSpec>): void {
    if (!fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkFilesForShared(full, into);
            continue;
        }
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.json5') && !entry.name.endsWith('.json') && !entry.name.endsWith('.env')) {
            continue;
        }
        try {
            collectSpecsFromText(fs.readFileSync(full, 'utf-8'), into);
        } catch {
            
        }
    }
}

export function materializeBootSharedRandEnv(baseDir: string = process.cwd()): Record<string, string> {
    const specs = new Map<string, SharedRandSpec>();

    for (const value of Object.values(process.env)) {
        if (typeof value === 'string' && value.includes('@shared')) {
            collectSpecsFromText(value, specs);
        }
    }

    walkFilesForShared(path.join(baseDir, 'configuration'), specs);
    walkFilesForShared(path.join(baseDir, 'plugins'), specs);
    walkFilesForShared(path.join(baseDir, 'src', 'plugins'), specs);

    const map = loadEnvMap();
    for (const spec of specs.values()) {
        const key = mapKey(spec);
        if (!map.has(key)) {
            if (isShardWorkerProcess()) {
                throw new Error(
                    `Shared boot rand missing for key "${key}" during materialize on a shard worker.`,
                );
            }
            const value = generate(spec.encoding, spec.length);
            map.set(key, value);
            emittedValues.add(value);
        }
    }

    persistEnvMap(map);
    const out: Record<string, string> = {};
    for (const [k, v] of map) out[k] = v;
    return out;
}

export function bootSharedEnvRecord(): Record<string, string> {
    const map = loadEnvMap();
    const out: Record<string, string> = {};
    for (const [k, v] of map) out[k] = v;
    return out;
}
