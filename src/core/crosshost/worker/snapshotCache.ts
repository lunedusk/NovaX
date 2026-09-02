import { createHash } from 'node:crypto';
import { applyPatch, type Operation } from '../jsonPatch.js';
import { getLogger } from '#core/utils/logger.js';
import { configManager } from '#core/manager/config.js';
import { i18n } from '#core/manager/lang.js';
import { emojis } from '#core/manager/emoji.js';
import type { SnapshotDocument, SnapshotEnvelope } from '../types.js';

const log = getLogger('CrossHost:SnapshotCache');

function hashDocument(doc: SnapshotDocument): string {
    return createHash('sha256').update(JSON.stringify(doc)).digest('hex');
}

function applyToManagers(document: SnapshotDocument): void {
    configManager.applySnapshot(document.config);
    i18n.applySnapshot(document.lang);
    emojis.applySnapshot(document.emoji);
}

export class SnapshotCache {
    private version = 0;
    private hash = '';
    private document: SnapshotDocument | null = null;

    public getVersion(): number {
        return this.version;
    }

    public getHash(): string {
        return this.hash;
    }

    public applyFull(envelope: SnapshotEnvelope): void {
        applyToManagers(envelope.document);
        this.document = envelope.document;
        this.version = envelope.version;
        this.hash = envelope.hash;
        log.info('Snapshot full apply', {
            version: this.version,
            hash: this.hash.slice(0, 12),
        });
        void import('#core/manager/event.js')
            .then(({ eventBus }) =>
                eventBus.emitConcurrent('crosshost.snapshot.applied', {
                    version: this.version,
                    mode: 'full',
                    hash: this.hash,
                }),
            )
            .catch(() => undefined);

    }

    public applyDiff(
        baseVersion: number,
        nextVersion: number,
        nextHash: string,
        patch: Operation[],
    ): boolean {
        if (!this.document || this.version !== baseVersion) {
            log.warn('Snapshot diff rejected: base mismatch', {
                have: this.version,
                wantBase: baseVersion,
                nextVersion,
            });
            return false;
        }
        try {
            const clone = JSON.parse(JSON.stringify(this.document)) as SnapshotDocument;
            const result = applyPatch(clone, patch, true, false);
            const nextDoc = result.newDocument as SnapshotDocument;
            const computed = hashDocument(nextDoc);
            if (computed !== nextHash) {
                log.warn('Snapshot diff rejected: hash mismatch after patch', {
                    nextVersion,
                    expected: nextHash.slice(0, 12),
                    got: computed.slice(0, 12),
                });
                return false;
            }
            applyToManagers(nextDoc);
            this.document = nextDoc;
            this.version = nextVersion;
            this.hash = nextHash;
            log.info('Snapshot diff apply', {
                version: this.version,
                baseVersion,
                ops: patch.length,
                hash: this.hash.slice(0, 12),
            });
            void import('#core/manager/event.js')
                .then(({ eventBus }) =>
                    eventBus.emitConcurrent('crosshost.snapshot.applied', {
                        version: this.version,
                        mode: 'diff',
                        hash: this.hash,
                    }),
                )
                .catch(() => undefined);

            return true;
        } catch (err) {
            log.warn('Snapshot diff apply failed; full fallback required', err);
            return false;
        }
    }
}
