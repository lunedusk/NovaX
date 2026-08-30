import { createHash } from 'node:crypto';
import { compare, applyPatch, type Operation } from 'fast-json-patch';
import type { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';
import { configManager } from '#core/manager/config.js';
import { i18n } from '#core/manager/lang.js';
import { emojis } from '#core/manager/emoji.js';
import type { SnapshotDocument, SnapshotEnvelope, SnapshotNotifyMessage } from '../types.js';
import { channelSnapshotNotify, keySnapshotFull, keySnapshotLatest } from '../protocol/channels.js';
import { encodeMessage } from '../protocol/codec.js';

const log = getLogger('CrossHost:Snapshot');

const MAX_RETAINED = 5;
const INLINE_MAX_BYTES = 512 * 1024;

function stableStringify(value: unknown): string {
    return JSON.stringify(value);
}

function hashDocument(doc: SnapshotDocument): string {
    return createHash('sha256').update(stableStringify(doc)).digest('hex');
}

export function buildSnapshotDocument(): SnapshotDocument {
    return {
        config: configManager.dumpSnapshot(),
        lang: i18n.dumpSnapshot(),
        emoji: emojis.dumpSnapshot(),
    };
}

export class SnapshotService {
    private version = 0;
    private readonly history = new Map<number, SnapshotEnvelope>();
    private latest: SnapshotEnvelope | null = null;
    private readonly redis: Redis;
    private readonly pub: Redis;
    private readonly channelPrefix: string;
    private readonly onVersion: (version: number) => void;

    constructor(
        redis: Redis,
        pub: Redis,
        channelPrefix: string,
        onVersion: (version: number) => void,
    ) {
        this.redis = redis;
        this.pub = pub;
        this.channelPrefix = channelPrefix;
        this.onVersion = onVersion;
    }

    public getVersion(): number {
        return this.version;
    }

    public getLatest(): SnapshotEnvelope | null {
        return this.latest;
    }

    public getEnvelope(version: number): SnapshotEnvelope | null {
        return this.history.get(version) ?? null;
    }

    public async publishFromManagers(forceFull = false): Promise<SnapshotEnvelope> {
        const document = buildSnapshotDocument();
        const hash = hashDocument(document);
        if (this.latest && this.latest.hash === hash && !forceFull) {
            log.debug('Snapshot unchanged; skip publish', { version: this.version, hash });
            return this.latest;
        }

        const base = this.latest;
        this.version += 1;
        const envelope: SnapshotEnvelope = {
            version: this.version,
            hash,
            document,
        };
        this.history.set(this.version, envelope);
        this.latest = envelope;
        this.onVersion(this.version);

        while (this.history.size > MAX_RETAINED) {
            const oldest = Math.min(...this.history.keys());
            this.history.delete(oldest);
        }

        await this.redis.set(
            keySnapshotFull(this.channelPrefix, this.version),
            JSON.stringify(envelope),
            'EX',
            86_400,
        );
        await this.redis.set(keySnapshotLatest(this.channelPrefix), String(this.version));

        let notify: SnapshotNotifyMessage;
        if (base && !forceFull) {
            const patch = compare(base.document as object, document as object) as Operation[];
            notify = {
                version: this.version,
                hash,
                mode: 'diff',
                baseVersion: base.version,
                patch,
            };
            log.info('Snapshot version bumped (diff)', {
                version: this.version,
                baseVersion: base.version,
                ops: patch.length,
                hash: hash.slice(0, 12),
            });
        } else {
            notify = {
                version: this.version,
                hash,
                mode: 'full',
            };
            log.info('Snapshot version bumped (full)', {
                version: this.version,
                hash: hash.slice(0, 12),
            });
        }

        await this.pub.publish(
            channelSnapshotNotify(this.channelPrefix),
            encodeMessage(notify).toString('base64'),
        );
        return envelope;
    }

    public buildDiffPatch(fromVersion: number, toVersion: number): Operation[] | null {
        const from = this.history.get(fromVersion);
        const to = this.history.get(toVersion);
        if (!from || !to) return null;
        return compare(from.document as object, to.document as object) as Operation[];
    }

    public applyPatchLocal(document: SnapshotDocument, patch: Operation[]): SnapshotDocument {
        const clone = JSON.parse(JSON.stringify(document)) as SnapshotDocument;
        const result = applyPatch(clone, patch, true, false);
        return result.newDocument as SnapshotDocument;
    }

    public shouldInline(envelope: SnapshotEnvelope): boolean {
        return Buffer.byteLength(JSON.stringify(envelope), 'utf8') <= INLINE_MAX_BYTES;
    }
}

export type { Operation };
