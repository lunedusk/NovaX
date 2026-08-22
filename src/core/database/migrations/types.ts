import type { SqlAdapter } from '#core/database/sqlAdapter.js';
import type { DataEngine } from '#core/database/backendSelector.js';

export interface MigrationContext {
    scope: string;
    engine: DataEngine;
    adapter: SqlAdapter;
}

export interface MigrationStep {
    version: number;
    name: string;
    up: (ctx: MigrationContext) => Promise<void>;
}

export interface MigrationScope {
    id: string;
    steps: MigrationStep[];
    alias?: string;
}
