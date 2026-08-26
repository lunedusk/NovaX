import type { MigrationContext, MigrationStep } from '../types.js';

async function columnExists(adapter: MigrationContext['adapter'], table: string, column: string): Promise<boolean> {
    if (adapter.engine === 'postgres') {
        const row = await adapter.get(
            `SELECT 1 AS ok FROM information_schema.columns
             WHERE table_name = ? AND column_name = ? LIMIT 1`,
            [table, column],
        );
        return !!row;
    }
    const rows = await adapter.all(`PRAGMA table_info(${table})`);
    return rows.some((r) => String(r.name) === column);
}

async function addColumnIfMissing(
    adapter: MigrationContext['adapter'],
    table: string,
    column: string,
    ddlType: string,
): Promise<void> {
    if (await columnExists(adapter, table, column)) return;
    await adapter.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddlType}`);
}

async function upSqlitePg(ctx: MigrationContext): Promise<void> {
    const { adapter } = ctx;
    await addColumnIfMissing(adapter, 'audit_entries', 'surface', 'TEXT');
    await addColumnIfMissing(adapter, 'audit_entries', 'request_id', 'TEXT');
    await addColumnIfMissing(adapter, 'audit_entries', 'target_ref', 'TEXT');
    await addColumnIfMissing(adapter, 'audit_entries', 'before_json', 'TEXT');
    await addColumnIfMissing(adapter, 'audit_entries', 'after_json', 'TEXT');
    try {
        await adapter.exec(`CREATE INDEX IF NOT EXISTS idx_audit_request_id ON audit_entries(request_id)`);
    } catch {
        return;
    }
    try {
        await adapter.exec(`CREATE INDEX IF NOT EXISTS idx_audit_surface ON audit_entries(surface)`);
    } catch {
        return;
    }
}

async function upMongo(ctx: MigrationContext): Promise<void> {
    const { mongoDB } = await import('#core/database/mongo.js');
    const conn = mongoDB.get(ctx.adapter.alias);
    const db = conn.db;
    if (!db) return;
    const existing = await db.listCollections({}, { nameOnly: true }).toArray();
    const have = new Set(existing.map((c: { name: string }) => c.name));
    if (!have.has('audit_entries')) {
        await db.createCollection('audit_entries');
    }
    const ensure = async (keys: Record<string, number>, unique = false) => {
        try {
            await db.collection('audit_entries').createIndex(keys, { unique });
        } catch {
            return;
        }
    };
    await ensure({ requestId: 1 }, false);
    await ensure({ surface: 1 }, false);
}

export const auditRecordV2: MigrationStep = {
    version: 4,
    name: 'audit_record_v2',
    async up(ctx) {
        if (ctx.engine === 'mongo') {
            await upMongo(ctx);
            return;
        }
        await upSqlitePg(ctx);
    },
};
