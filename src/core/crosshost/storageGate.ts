import { secrets } from '#core/helpers/secretManager.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('CrossHost:StorageGate');

const FORBIDDEN_ENGINES = new Set([
    'sqlite',
    'native-sqlite',
    'better-sqlite3',
]);

function isFileUri(uri: string): boolean {
    const lower = uri.trim().toLowerCase();
    if (lower.startsWith('file:')) return true;
    if (lower.endsWith('.db') || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3')) return true;
    if (lower.startsWith('/') || /^[a-z]:[\\/]/i.test(lower)) {
        if (!lower.startsWith('postgres') && !lower.startsWith('mysql') && !lower.startsWith('mongodb') && !lower.startsWith('redis')) {
            return true;
        }
    }
    return false;
}

export function assertCrossHostStorageAllowed(): void {
    const raw = secrets.getOptional('Database') ?? '{}';
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('Cross-Host storage gate: Database env is not valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Cross-Host storage gate: Database env must be a JSON object');
    }

    const map = parsed as Record<string, unknown>;
    for (const [alias, entry] of Object.entries(map)) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
        const rec = entry as Record<string, unknown>;
        const uri = typeof rec.uri === 'string' ? rec.uri : '';
        const engine = typeof rec.engine === 'string' ? rec.engine.toLowerCase() : '';

        if (engine && FORBIDDEN_ENGINES.has(engine)) {
            throw new Error(
                `Cross-Host forbids sqlite/local-file engines. Database[${alias}] engine=${engine}. Use networked Redis/Postgres/MySQL/Mongo or per-worker native-novadb only for local bodies.`,
            );
        }
        if (uri && isFileUri(uri) && (engine === '' || FORBIDDEN_ENGINES.has(engine) || engine.includes('sqlite'))) {
            throw new Error(
                `Cross-Host forbids file-path database URIs for multi-host. Database[${alias}] uri looks local (${uri.slice(0, 80)}).`,
            );
        }
    }

    log.info('Cross-Host storage gate passed (no sqlite/file primary engines)');
}
