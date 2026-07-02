import { BaseCommand, type CommandConfig } from '#core/bases/Command.js';
import { SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { buildComponentsV2, type Cv2LayoutSpec } from '#core/builders/index.js';
import { Cooldown } from '#core/decorators/cooldown.js';
import type PermissionsHandler from '../../../permissions/src/handlers/manager.js';
import { BITS, BOT_OWNER_BIT } from '../lib/bits.js';

export default class RestartCommand extends BaseCommand {

    public readonly data = new SlashCommandBuilder()
        .setName('restart')
        .setDescription(this.t('commands.restart.description'))
        .addStringOption(opt =>
            opt.setName('reason')
               .setDescription(this.t('commands.restart.reasonDescription'))
               .setRequired(false)
        );

    public readonly config: CommandConfig = {
        permissionLevel: 'owner',
        autoDefer: false,
        allowInDm: true
    };

    @Cooldown('core-restart', { limit: 1, windowMs: 30_000 })
    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        try {
            const perms = this.heart.system.handler.$get('permissions', 'manager') as PermissionsHandler | undefined;
            if (!perms) {
                return this.replyContainer(interaction, false, 'Permission System', this.t('commands.restart.messages.unavailable'));
            }

            const guildId = interaction.guildId ?? undefined;
            const allowed =
                await perms.hasBit(interaction.user.id, BOT_OWNER_BIT, guildId) ||
                await perms.hasBit(interaction.user.id, BITS.BOT_MEMBERS_BAN, guildId);

            if (!allowed) {
                return this.replyContainer(interaction, false, 'Access Denied', this.t('commands.restart.messages.denied'));
            }

            const reason = interaction.options.getString('reason') ?? 'No reason provided';
            this.log.warn(`Restart triggered by ${interaction.user.tag} (${interaction.user.id}): ${reason}`);

            await this.replyContainer(interaction, true, 'System Restart', this.t('commands.restart.messages.acknowledged', {
                user: interaction.user.tag,
                reason
            }));

            setTimeout(() => process.exit(0), 1000);

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.log.error(`Restart Command Exception: ${err.message}`);
            await this.replyContainer(interaction, false, 'System Execution', this.t('commands.restart.messages.fatalError', { error: err.message }));
        }
    }

    private async replyContainer(interaction: ChatInputCommandInteraction, success: boolean, title: string, details: string): Promise<void> {
        const layoutKey = success ? 'layouts.containerSuccess' : 'layouts.containerError';
        const rawJson = this.t(layoutKey, { title });

        const layout: Cv2LayoutSpec = JSON.parse(rawJson);
        const container = layout.components[0] as any;
        container.children[2].content = details;

        const payload = buildComponentsV2(layout);
        await interaction.editReply(payload);
    }
}