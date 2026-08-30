import { random } from '#core/utils/random.js';
import { format } from '#core/utils/format.js';
import { EmojiSyncer } from '#core/helpers/emojiSync.js';
import { IntegrityManager } from '#core/helpers/integrity.js';
import { HybridVault, SecureVault } from '#core/helpers/enclave.js';
import { codecRegistry as codec } from '#core/helpers/codec.js';
import { TTLCache as Cache } from '#core/helpers/cache.js';
import { PackageManager } from '#core/helpers/integrity/manifest.js';
import { BloomFilter } from '#core/helpers/bloom.js';
import { hashFile, hashBuffer, HASH_ALGORITHM } from '#core/helpers/hash/index.js';
import { SemVer, SemVerRange } from '#core/utils/semver.js';
import { NodeVersion } from '#core/utils/nodever.js';
import { redactSensitiveData } from '#core/utils/redaction.js';

export type ToolboxDomain = {
    readonly utils: {
        readonly random: typeof random;
        readonly format: typeof format;
        readonly EmojiSyncer: typeof EmojiSyncer;
        readonly hash: {
            readonly hashFile: typeof hashFile;
            readonly hashBuffer: typeof hashBuffer;
            readonly HASH_ALGORITHM: typeof HASH_ALGORITHM;
        };
        readonly semver: {
            readonly SemVer: typeof SemVer;
            readonly SemVerRange: typeof SemVerRange;
        };
        readonly nodever: {
            readonly NodeVersion: typeof NodeVersion;
        };
        readonly redact: typeof redactSensitiveData;
    };
    readonly security: {
        readonly integrity: typeof IntegrityManager;
        readonly manifest: typeof PackageManager;
        readonly HybridVault: typeof HybridVault;
        readonly SecureVault: typeof SecureVault;
    };
    readonly data: {
        readonly codec: typeof codec;
        readonly Cache: typeof Cache;
        readonly BloomFilter: typeof BloomFilter;
    };
};

export const toolboxDomain: ToolboxDomain = Object.freeze({
    utils: Object.freeze({
        random,
        format,
        EmojiSyncer,
        hash: Object.freeze({ hashFile, hashBuffer, HASH_ALGORITHM }),
        semver: Object.freeze({ SemVer, SemVerRange }),
        nodever: Object.freeze({ NodeVersion }),
        redact: redactSensitiveData,
    }),
    security: Object.freeze({
        integrity: IntegrityManager,
        manifest: PackageManager,
        HybridVault,
        SecureVault,
    }),
    data: Object.freeze({
        codec,
        Cache,
        BloomFilter,
    }),
});
