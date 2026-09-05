import { BaseEvent } from '#core/bases/Event.js';
import { type AnySelectMenuInteraction, type ButtonInteraction } from 'discord.js';
import { buildComponentsV2, type Cv2LayoutSpec } from '#core/builders/index.js';
import type { ContainerSpec, ActionRowSpec, ComponentSpec } from '#core/builders/componentsv2Builder/types.js';
import { Cooldown } from '#core/decorators/cooldown.js';
import { HelpUtils, type HelpPluginGroup } from '../utils/helpUtils.js';

export default class HelpMenuEvent extends BaseEvent<[unknown]> {
    public readonly name = 'discord.interactionCreate';
    public readonly once = false;

    public readonly buttons = new Map<
        string | RegExp,
        (interaction: ButtonInteraction, match?: RegExpMatchArray) => Promise<void>
    >([
        [
            /^core_help_nav:([^:]+):([^:]+):(\d+)$/,
            (i: ButtonInteraction, match?: RegExpMatchArray) => {
                if (!match) return Promise.resolve();
                return this.handleNavigation(i, match[1], match[2], parseInt(match[3], 10));
            },
        ],
    ]);

    public readonly selects = new Map<
        string | RegExp,
        (interaction: AnySelectMenuInteraction, match?: RegExpMatchArray) => Promise<void>
    >([
        [
            /^core_help_nav:([^:]+):([^:]+):(\d+)$/,
            (i: AnySelectMenuInteraction, match?: RegExpMatchArray) => {
                if (!match) return Promise.resolve();
                return this.handleNavigation(i, match[1], i.values[0], 0);
            },
        ],
    ]);

    @Cooldown('core-help-nav', { limit: 2, windowMs: 3000 })
    private async handleNavigation(
        interaction: ButtonInteraction | AnySelectMenuInteraction,
        type: string,
        targetId: string,
        page: number,
    ): Promise<void> {
        try {
            const plugins = await HelpUtils.fetchEcosystemData(this.heart, interaction);
            const config = this.heart.assets.config.get<{ help?: { maxCharsPerPage?: number } }>('core');
            const maxChars = config?.help?.maxCharsPerPage ?? 3000;

            const baseLayoutStr = this.heart.assets.lang.get(this.heart.id, 'layouts.helpContainer');
            const layout: Cv2LayoutSpec = JSON.parse(baseLayoutStr) as Cv2LayoutSpec;
            const container = layout.components[0] as ContainerSpec;
            if (!container.children) container.children = [];

            if (type === 'home') this.buildHomeView(container, plugins, page);
            else if (type === 'plugin') this.buildPluginView(container, plugins, targetId, page, maxChars);
            else if (type === 'cmd') this.buildCommandView(container, plugins, targetId, page, maxChars);
            else if (type === 'group') this.buildGroupView(container, plugins, targetId, page, maxChars);

            await interaction.update(buildComponentsV2(layout));
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.heart.log.error(`Help Menu Exception: ${err.message}`);
        }
    }

    private buildHomeView(container: ContainerSpec, plugins: HelpPluginGroup[], page: number): void {
        const totalCmds = plugins.reduce((acc, p) => acc + p.commands.length, 0);

        container.children.push(
            {
                type: 'text',
                content: `**${HelpUtils.getEmoji(this.heart, 'menu')} ${this.heart.assets.lang.get(this.heart.id, 'commands.help.homeTitle')}**`,
            },
            { type: 'separator', spacing: 'small' },
            {
                type: 'text',
                content: this.heart.assets.lang.get(this.heart.id, 'commands.help.homeDesc', {
                    plugins: plugins.length,
                    commands: totalCmds,
                    emoji_menu: HelpUtils.getEmoji(this.heart, 'menu'),
                    emoji_command: HelpUtils.getEmoji(this.heart, 'command'),
                }),
            },
        );

        const PLUGINS_PER_PAGE = 100;
        const totalPages = Math.ceil(plugins.length / PLUGINS_PER_PAGE) || 1;
        const safePage = Math.max(0, Math.min(page, totalPages - 1));
        const pagedPlugins = plugins.slice(safePage * PLUGINS_PER_PAGE, (safePage + 1) * PLUGINS_PER_PAGE);

        for (let i = 0; i < pagedPlugins.length; i += 25) {
            const chunk = pagedPlugins.slice(i, i + 25);
            container.children.push({
                type: 'actionRow',
                components: [
                    {
                        type: 'selectMenu',
                        kind: 'string',
                        customId: `core_help_nav:plugin:none:0`,
                        placeholder: this.heart.assets.lang.get(this.heart.id, 'commands.help.pluginSelectPlaceholder', {
                            start: safePage * PLUGINS_PER_PAGE + i + 1,
                            end: safePage * PLUGINS_PER_PAGE + i + chunk.length,
                        }),
                        options: chunk.map((p) => ({
                            label: p.name,
                            value: p.id,
                            emoji: p.emoji,
                            description: `${p.commands.length} command(s)`,
                        })),
                    },
                ],
            });
        }
        this.appendPagination(container, 'home', 'none', safePage, totalPages);
    }

    private buildPluginView(
        container: ContainerSpec,
        plugins: HelpPluginGroup[],
        pluginId: string,
        page: number,
        maxChars: number,
    ): void {
        const plugin = plugins.find((p) => p.id === pluginId);
        if (!plugin) return this.buildHomeView(container, plugins, 0);

        container.children.push(
            {
                type: 'text',
                content: `**${plugin.emoji} ${this.heart.assets.lang.get(this.heart.id, 'commands.help.categoryTitle', { name: plugin.name })}**`,
            },
            { type: 'separator', spacing: 'small' },
            {
                type: 'text',
                content: `> ${HelpUtils.getEmoji(this.heart, 'command')} **${plugin.commands.length}** accessible command(s) in this module`,
            },
            { type: 'separator', spacing: 'small' },
        );

        if (plugin.commands.length === 0) {
            container.children.push({
                type: 'text',
                content: this.heart.assets.lang.get(this.heart.id, 'commands.help.noCommands'),
            });
            return this.appendPagination(container, 'plugin', pluginId, 0, 1);
        }

        const pages = HelpUtils.chunkCommands(plugin.commands, maxChars);
        const safePage = Math.max(0, Math.min(page, pages.length - 1));
        const currentCommands = pages[safePage];

        container.children.push({
            type: 'text',
            content: currentCommands.map((c) => `• ${c.rawFormatted}`).join('\n'),
        });

        container.children.push({
            type: 'actionRow',
            components: [
                {
                    type: 'selectMenu',
                    kind: 'string',
                    customId: `core_help_nav:cmd:${pluginId}:0`,
                    placeholder: this.heart.assets.lang.get(this.heart.id, 'commands.help.cmdSelectPlaceholder'),
                    options: currentCommands.slice(0, 25).map((c) => ({
                        label: `/${c.name}`,
                        value: `${pluginId}$${c.name}`,
                        description: c.description.substring(0, 100),
                        emoji: HelpUtils.getEmoji(this.heart, 'command'),
                    })),
                },
            ],
        });

        this.appendPagination(container, 'plugin', pluginId, safePage, pages.length);
    }

    private buildCommandView(
        container: ContainerSpec,
        plugins: HelpPluginGroup[],
        targetId: string,
        page: number,
        maxChars: number,
    ): void {
        const [pluginId, cmdName] = targetId.split('$');
        const plugin = plugins.find((p) => p.id === pluginId);
        const cmd = plugin?.commands.find((c) => c.name === cmdName);

        if (!cmd) return this.buildHomeView(container, plugins, 0);

        if (cmd.type === 'has_groups') {
            container.children.push(
                {
                    type: 'text',
                    content:
                        `**${HelpUtils.getEmoji(this.heart, 'command')} ` +
                        this.heart.assets.lang.get(this.heart.id, 'commands.help.commandDetailTitle', {
                            name: cmd.name,
                        }) +
                        `**`,
                },
                { type: 'separator', spacing: 'small' },
            );
            container.children.push({
                type: 'actionRow',
                components: [
                    {
                        type: 'selectMenu',
                        kind: 'string',
                        customId: `core_help_nav:group:${pluginId}$${cmdName}:0`,
                        placeholder: this.heart.assets.lang.get(this.heart.id, 'commands.help.groupSelectPlaceholder'),
                        options: cmd.children.map((g) => ({
                            label: `/${cmdName} ${g.name}`,
                            value: `${pluginId}$${cmdName}$${g.name}`,
                            description: g.description.substring(0, 100),
                            emoji: HelpUtils.getEmoji(this.heart, 'command'),
                        })),
                    },
                ],
            });
            return this.appendPagination(container, 'cmd', targetId, 0, 1, `core_help_nav:plugin:${pluginId}:0`);
        }

        if (cmd.type === 'has_subs') {
            const commandsPerPage = 2;
            const children = cmd.children;
            const totalPages =
                children.length > commandsPerPage
                    ? Math.ceil(children.length / commandsPerPage)
                    : 1;
            const safePage = Math.max(0, Math.min(page, totalPages - 1));
            const pageChildren =
                totalPages > 1
                    ? children.slice(
                          safePage * commandsPerPage,
                          (safePage + 1) * commandsPerPage,
                      )
                    : children;

            const blocksToRender = HelpUtils.buildFullInfoBlocks(this.heart, pageChildren);
            const viewTitle = this.heart.assets.lang.get(this.heart.id, 'commands.help.commandDetailTitle', {
                name: cmd.name,
            });
            const backTarget = `core_help_nav:plugin:${pluginId}:0`;

            container.children.push(
                {
                    type: 'text',
                    content: `**${HelpUtils.getEmoji(this.heart, 'command')} ${viewTitle}**`,
                },
                { type: 'separator', spacing: 'large' },
            );

            for (let i = 0; i < blocksToRender.length; i++) {
                container.children.push({ type: 'text', content: blocksToRender[i] });
                if (i < blocksToRender.length - 1) {
                    container.children.push({ type: 'separator', spacing: 'large' });
                }
            }

            this.appendPagination(container, 'cmd', targetId, safePage, totalPages, backTarget);
            return;
        }

        const blocksToRender = HelpUtils.buildFullInfoBlocks(this.heart, [cmd]);
        this.renderDetailBlocks(
            container,
            blocksToRender,
            'cmd',
            targetId,
            page,
            maxChars,
            `core_help_nav:plugin:${pluginId}:0`,
        );
    }

    private buildGroupView(
        container: ContainerSpec,
        plugins: HelpPluginGroup[],
        targetId: string,
        page: number,
        _maxChars: number,
    ): void {
        const [pluginId, cmdName, groupName] = targetId.split('$');
        const plugin = plugins.find((p) => p.id === pluginId);
        const cmd = plugin?.commands.find((c) => c.name === cmdName);
        const group = cmd?.children.find((g) => g.name === groupName);

        if (!group) return this.buildHomeView(container, plugins, 0);

        const commandsPerPage = 2;
        const children = group.children;
        const totalPages =
            children.length > commandsPerPage
                ? Math.ceil(children.length / commandsPerPage)
                : 1;
        const safePage = Math.max(0, Math.min(page, totalPages - 1));
        const pageChildren =
            totalPages > 1
                ? children.slice(
                      safePage * commandsPerPage,
                      (safePage + 1) * commandsPerPage,
                  )
                : children;

        const blocksToRender = HelpUtils.buildFullInfoBlocks(this.heart, pageChildren);
        const viewTitle = this.heart.assets.lang.get(this.heart.id, 'commands.help.commandDetailTitle');
        const backTarget = `core_help_nav:cmd:${pluginId}$${cmdName}:0`;

        container.children.push(
            { type: 'text', content: `**${HelpUtils.getEmoji(this.heart, 'command')} ${viewTitle}**` },
            { type: 'separator', spacing: 'large' },
        );

        for (let i = 0; i < blocksToRender.length; i++) {
            container.children.push({ type: 'text', content: blocksToRender[i] });
            if (i < blocksToRender.length - 1) {
                container.children.push({ type: 'separator', spacing: 'large' });
            }
        }

        this.appendPagination(container, 'group', targetId, safePage, totalPages, backTarget);
    }

    private renderDetailBlocks(
        container: ContainerSpec,
        blocks: string[],
        type: string,
        targetId: string,
        page: number,
        maxChars: number,
        backTarget: string,
    ): void {
        const pages: string[][] = [];
        let bucket: string[] = [];
        let used = 0;
        for (const block of blocks) {
            if (used + block.length > maxChars && bucket.length > 0) {
                pages.push(bucket);
                bucket = [];
                used = 0;
            }
            bucket.push(block);
            used += block.length;
        }
        if (bucket.length > 0) pages.push(bucket);

        const totalPages = pages.length || 1;
        const safePage = Math.max(0, Math.min(page, totalPages - 1));
        const currentBlocks = pages[safePage] ?? [];

        const viewTitle = this.heart.assets.lang.get(this.heart.id, 'commands.help.commandDetailTitle');

        container.children.push(
            { type: 'text', content: `**${HelpUtils.getEmoji(this.heart, 'command')} ${viewTitle}**` },
            { type: 'separator', spacing: 'large' },
        );

        for (let i = 0; i < currentBlocks.length; i++) {
            container.children.push({ type: 'text', content: currentBlocks[i] });

            if (i < currentBlocks.length - 1) {
                container.children.push({ type: 'separator', spacing: 'large' });
            }
        }

        this.appendPagination(container, type, targetId, safePage, totalPages, backTarget);
    }

    private appendPagination(
        container: ContainerSpec,
        type: string,
        targetId: string,
        page: number,
        totalPages: number,
        backTarget?: string,
    ): void {
        const needsPagination = totalPages > 1;
        const isDeep = type !== 'home';

        if (!needsPagination && !isDeep) return;

        const row: ActionRowSpec = { type: 'actionRow', components: [] };

        if (isDeep) {
            row.components.push({
                type: 'button',
                style: 'secondary',
                customId: `core_help_nav:home:none:0`,
                emoji: HelpUtils.getEmoji(this.heart, 'navHome'),
                label: '\u200b',
            });
            if (backTarget)
                row.components.push({
                    type: 'button',
                    style: 'secondary',
                    customId: backTarget,
                    label: this.heart.assets.lang.get(this.heart.id, 'commands.help.backButton'),
                    emoji: HelpUtils.getEmoji(this.heart, 'navBack'),
                });
        }

        if (needsPagination) {
            const utilCount = row.components.length;
            row.components.push({
                type: 'button',
                style: 'primary',
                customId: `core_help_nav:${type}:${targetId}:${page - 1}`,
                emoji: HelpUtils.getEmoji(this.heart, 'navLeft'),
                disabled: page <= 0,
                label: '​',
            });
            if (utilCount === 0) {
                row.components.push({
                    type: 'button',
                    style: 'secondary',
                    customId: `mock_page_ind`,
                    label: this.heart.assets.lang.get(this.heart.id, 'commands.help.pageFooter', {
                        current: page + 1,
                        total: totalPages,
                    }),
                    disabled: true,
                });
            }
            row.components.push({
                type: 'button',
                style: 'primary',
                customId: `core_help_nav:${type}:${targetId}:${page + 1}`,
                emoji: HelpUtils.getEmoji(this.heart, 'navRight'),
                disabled: page >= totalPages - 1,
                label: '​',
            });
        }

        if (row.components.length > 0) container.children.push(row as ComponentSpec);
    }

    public async execute(): Promise<void> {}
}
