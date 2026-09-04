import { MessageFlags } from 'discord.js';
import { buildComponentsV2 } from '#core/builders/componentsv2Builder.js';
import type { PageMeta } from '../types/models.js';
import type { ButtonBuilder } from 'discord.js';
import { buildNavRow } from '../controls/buttons.js';

export function renderCv2Page(options: {
    readonly title?: string;
    readonly body: string;
    readonly meta: PageMeta;
    readonly accentColor?: number;
    readonly navButtons: ButtonBuilder[];
    readonly utilButtons?: ButtonBuilder[];
}): {
    components: ReturnType<typeof buildComponentsV2>['components'];
    files: ReturnType<typeof buildComponentsV2>['files'];
    flags: number | number[];
} {
    const header = options.title
        ? `**${options.title}**\n_Page ${options.meta.page}/${options.meta.pages}_`
        : `_Page ${options.meta.page}/${options.meta.pages}_`;
    const body = options.body.length > 0 ? options.body : '\u200B';

    const built = buildComponentsV2(
        {
            version: 1,
            components: [
                {
                    type: 'container',
                    accentColor: options.accentColor ?? 0x5865f2,
                    children: [
                        { type: 'text', content: header },
                        { type: 'separator', spacing: 'small' },
                        { type: 'text', content: body },
                    ],
                },
            ],
        },
        {},
        { autoWrapInteractives: true },
    );

    const rows = buildNavRow(options.navButtons, options.utilButtons);
    const components = [...built.components, ...rows];

    return {
        components,
        files: built.files,
        flags: built.flags ?? MessageFlags.IsComponentsV2,
    };
}
