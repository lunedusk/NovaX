import type { MigrationStep } from '#core/database/migrations/types.js';

export const migrations: MigrationStep[] = [
    {
        version: 1,
        name: 'dashboard_schema_delegated',
        async up() {
            return;
        },
    },
];
