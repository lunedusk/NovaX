import type { MigrationStep } from '../types.js';
import { initialSchema } from './001_initial_schema.js';
import { auditEntries } from './002_audit_entries.js';
import { errorOccurrences } from './003_error_occurrences.js';
import { auditRecordV2 } from './004_audit_record_v2.js';

export const coreMigrationSteps: MigrationStep[] = [
    initialSchema,
    auditEntries,
    errorOccurrences,
    auditRecordV2,
];
