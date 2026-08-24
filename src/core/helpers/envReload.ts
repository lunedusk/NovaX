import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import {
    expandValue,
    persistUntaggedRandInEnvFiles,
    type ExpandOptions,
} from '#core/placeholder/index.js';

const log = getLogger('EnvReload');

function isProduction(): boolean {
    const env = process.env.NODE_ENV?.trim().toLowerCase();
    return !env || env === 'production';
}

function envFilePaths(): string[] {
    return [path.join(process.cwd(), '.env'), path.join(process.cwd(), '.env.local')];
}

function parseEnvFile(content: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        if (!key || /\s/.test(key)) continue;
        let val = trimmed.slice(eq + 1).trim();
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        out.set(key, val);
    }
    return out;
}

export interface EnvReloadResult {
    updated: string[];
    skipped: string[];
    filesRead: string[];
}

export function reloadEnvFromDisk(): EnvReloadResult {
    const filesRead: string[] = [];
    const fileValues = new Map<string, string>();

    for (const filePath of envFilePaths()) {
        if (!fs.existsSync(filePath)) continue;
        filesRead.push(path.basename(filePath));
        const parsed = parseEnvFile(fs.readFileSync(filePath, 'utf-8'));
        for (const [k, v] of parsed) {
            fileValues.set(k, v);
        }
    }

    const allowSet = new Set(fileValues.keys());
    const mutations = new Map<string, string>();
    const allPersists = new Map<string, string>();
    const opts: ExpandOptions = {
        failClosed: isProduction(),
        resolveEmoji: false,
        collectUntaggedRand: true,
        softMiss: 'absent',
    };

    for (const [key, raw] of fileValues) {
        if (!raw.includes('${') && !raw.includes('%%')) {
            mutations.set(key, raw);
            continue;
        }
        try {
            const { value, untaggedRandPersists } = expandValue(raw, opts);
            for (const [p, v] of untaggedRandPersists) {
                allPersists.set(p, v);
            }
            if (typeof value === 'string') {
                mutations.set(key, value);
            } else {
                mutations.set(key, '');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error(`Env reload expansion failed for [${key}]: ${message}`);
            throw err;
        }
    }

    persistUntaggedRandInEnvFiles(allPersists);

    const { updated, skipped } = secrets.applyEnvReload(mutations, allowSet);
    log.info(
        `Env reload complete (files=${filesRead.join(',') || 'none'} updated=${updated.length} skipped=${skipped.length})`,
    );
    return { updated, skipped, filesRead };
}
