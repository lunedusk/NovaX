import type { MigrationScope, MigrationStep } from './types.js';

const scopes = new Map<string, MigrationScope>();

export function registerMigrationScope(id: string, steps: MigrationStep[], alias?: string): void {
    const sorted = [...steps].sort((a, b) => a.version - b.version);
    scopes.set(id, { id, steps: sorted, alias });
}

export function getRegisteredScopes(): MigrationScope[] {
    return [...scopes.values()];
}

export function clearMigrationRegistry(): void {
    scopes.clear();
}
