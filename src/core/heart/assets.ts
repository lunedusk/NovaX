import { configManager } from '#core/manager/config.js';
import { i18n } from '#core/manager/lang.js';
import { emojis } from '#core/manager/emoji.js';

export type AssetsDomain = {
    readonly config: typeof configManager;
    readonly lang: typeof i18n;
    readonly emoji: typeof emojis;
};

export const assetsDomain: AssetsDomain = Object.freeze({
    config: configManager,
    lang: i18n,
    emoji: emojis
});