import { EmbedBuilder } from 'discord.js';
import type { PageMeta } from '../types/models.js';
import type { ButtonBuilder } from 'discord.js';
import { buildNavRow } from '../controls/buttons.js';

export function renderEmbedPage(options: {
    readonly title?: string;
    readonly body: string;
    readonly meta: PageMeta;
    readonly accentColor?: number;
    readonly navButtons: ButtonBuilder[];
    readonly utilButtons?: ButtonBuilder[];
}): {
    embeds: EmbedBuilder[];
    components: ReturnType<typeof buildNavRow>;
} {
    const embed = new EmbedBuilder()
        .setColor(options.accentColor ?? 0x5865f2)
        .setDescription(options.body.slice(0, 4096) || '\u200B')
        .setFooter({ text: `Page ${options.meta.page}/${options.meta.pages}` });
    if (options.title) embed.setTitle(options.title.slice(0, 256));

    return {
        embeds: [embed],
        components: buildNavRow(options.navButtons, options.utilButtons),
    };
}
