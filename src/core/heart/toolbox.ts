// --- 1. Utilities ---
import { random } from '#core/utils/random.js';
import { format } from '#core/utils/format.js';
import { EmojiSyncer } from '#core/helpers/emojiSync.js';
import { IntegrityManager } from '#core/helpers/integrity.js';
import { HybridVault, SecureVault } from '#core/helpers/enclave.js';
import { codecRegistry as codec } from '#core/helpers/codec.js'; 
import { TTLCache as Cache } from '#core/helpers/cache.js'; 
import { PackageManager } from '#core/helpers/integrity/manifest.js';

export type ToolboxDomain = {
    readonly utils: {
        readonly random: typeof random;
        readonly format: typeof format;
        readonly EmojiSyncer: typeof EmojiSyncer;
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
    };
};

export const toolboxDomain: ToolboxDomain = Object.freeze({
    utils: Object.freeze({
        random,
        format,
        EmojiSyncer
    }),
    security: Object.freeze({
        integrity: IntegrityManager,
        manifest: PackageManager,
        HybridVault,
        SecureVault
    }),
    data: Object.freeze({
        codec,
        Cache
    })
});