import { MessageFlags, type ButtonBuilder } from 'discord.js';
import { buildComponentsV2, type ComponentSpec } from '#core/builders/componentsv2Builder.js';
import type { PageMeta } from '../types/models.js';
import { buttonBuildersToCv2ActionRows, navHasPageIndicator } from '../controls/buttons.js';


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
    const showPageInText =
        options.meta.pages > 1 && !navHasPageIndicator(options.navButtons);
    const header = options.title
        ? showPageInText
            ? `**${options.title}**\n_Page ${options.meta.page}/${options.meta.pages}_`
            : `**${options.title}**`
        : showPageInText
          ? `_Page ${options.meta.page}/${options.meta.pages}_`
          : '\u200B';
    const body = options.body.length > 0 ? options.body : '\u200B';

    const navRows = buttonBuildersToCv2ActionRows(options.navButtons, options.utilButtons);

    const children: ComponentSpec[] = [
        { type: 'text', content: header },
        { type: 'separator', spacing: 'small' },
        { type: 'text', content: body },
        ...navRows,
    ];


    const built = buildComponentsV2(
        {
            version: 1,
            components: [
                {
                    type: 'container',
                    accentColor: options.accentColor ?? 0x5865f2,
                    children,
                },
            ],
        },
        {},
        { autoWrapInteractives: true },
    );

    return {
        components: built.components,
        files: built.files,
        flags: built.flags ?? MessageFlags.IsComponentsV2,
    };
}
