import { 
    type ChatInputCommandInteraction, 
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { BaseCommand } from '../../../../core/bases/Command.js';
import { Cooldown } from '../../../../core/decorators/cooldown.js';
import { getLogger } from '../../../../core/utils/logger.js';

export default class CryptoCommand extends BaseCommand {

    public readonly data = new SlashCommandBuilder()
        .setName('crypto')
        .setDescription('Enterprise Cryptocurrency Address Manager (SOL & LTC)')
        .setIntegrationTypes([0, 1]) 
        .setContexts([0, 1, 2])      
        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Store a new Solana or Litecoin address.')
            .addStringOption(opt => opt.setName('address').setDescription('The exact wallet address.').setRequired(true))
            .addStringOption(opt => opt.setName('label').setDescription('A friendly name (e.g. Main Vault, Trading).').setRequired(false))
        )
        .addSubcommand(sub => sub
            .setName('get')
            .setDescription('Retrieve your stored addresses.')
            .addStringOption(opt => opt.setName('query').setDescription('Filter by partial address, coin, or label.').setRequired(false))
            .addIntegerOption(opt => opt.setName('page').setDescription('Page number to view.').setMinValue(1).setRequired(false))
        )
        .addSubcommand(sub => sub
            .setName('remove')
            .setDescription('Delete a stored crypto address.')
            .addStringOption(opt => opt.setName('query').setDescription('Filter the addresses you want to delete.').setRequired(false))
            .addIntegerOption(opt => opt.setName('page').setDescription('Page number to view.').setMinValue(1).setRequired(false))
        )

    private e(name: string, fallback: string): string {
        return this.heart.assets.emoji.get(name) || fallback;
    }

    private getDatabasePool() {
        try { return this.heart.db.postgres.get('crypto'); } 
        catch { return this.heart.db.postgres.get('main'); }
    }

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'get') {
            await interaction.deferReply(); 
        } else {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }); 
        }

        if (subcommand === 'add') await this.handleAdd(interaction);
        else if (subcommand === 'get') await this.handleGet(interaction);
        else if (subcommand === 'remove') await this.handleRemove(interaction);
    }

    private detectAddress(address: string) {
        let detectedNetworks: string[] = [];

        if (/^(ltc1|[LM])[a-km-zA-HJ-NP-Z1-9]{26,33}$/.test(address)) detectedNetworks.push('Litecoin');
        else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) detectedNetworks.push('Solana');

        if (detectedNetworks.length === 0) detectedNetworks = ['Unknown'];
        const finalCoin = detectedNetworks[0] === 'Solana' ? 'SOL' : (detectedNetworks[0] === 'Litecoin' ? 'LTC' : 'UNKNOWN');

        return { detectedNetworks, finalCoin };
    }

    private async handleAdd(interaction: ChatInputCommandInteraction) {
        const address = interaction.options.getString('address', true).trim();
        const label = interaction.options.getString('label') || 'Wallet';
        const pool = this.getDatabasePool();

        const { detectedNetworks, finalCoin } = this.detectAddress(address);

        if (detectedNetworks[0] === 'Unknown') {
            return await interaction.editReply({ content: `${this.e('cross', '❌')} Invalid format. Only SOL and LTC are supported.`, components: [] });
        }

        await pool.query(`
            INSERT INTO crypto_addresses (discord_id, address, coin, label, networks)
            VALUES ($1, $2, $3, $4, $5) RETURNING id
        `, [interaction.user.id, address, finalCoin, label, JSON.stringify(detectedNetworks)]);
        
        const e_tick = this.e('tick', '✅');

        const container = new ContainerBuilder()
            .setAccentColor(0x2ECC71)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${e_tick} Address Saved`),
                new TextDisplayBuilder().setContent(
                    `**Label:** \`${label}\`\n` +
                    `**Coin:** \`${finalCoin}\`\n` +
                    `**Network:** \`${detectedNetworks[0]}\`\n` +
                    `**Address:** \`${address}\``
                )
            );

        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    private async handleGet(interaction: ChatInputCommandInteraction) {
        const query = interaction.options.getString('query')?.toLowerCase();
        const page = interaction.options.getInteger('page') || 1;
        const limit = 5;
        const offset = (page - 1) * limit;
        const pool = this.getDatabasePool();

        let baseQuery = `FROM crypto_addresses WHERE discord_id = $1`;
        const params: any[] = [interaction.user.id];

        if (query) {
            baseQuery += ` AND (LOWER(address) LIKE $2 OR LOWER(coin) LIKE $2 OR LOWER(label) LIKE $2)`;
            params.push(`%${query}%`);
        }

        const countRes = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
        const total = parseInt(countRes.rows[0].count, 10);
        const totalPages = Math.max(1, Math.ceil(total / limit));

        if (total === 0 || page > totalPages) {
            await interaction.editReply({ content: `${this.e('cross', '❌')} No matching addresses found.`, components: [] });
            return;
        }

        const res = await pool.query(`SELECT * ${baseQuery} ORDER BY coin ASC, added_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);

        const e_safe = this.e('bank', '🏦');
        const e_link = this.e('link', '🔗');
        const e_box = this.e('box', '📦');
        const safeQuery = query ? query.substring(0, 30) : 'none';

        const container = new ContainerBuilder()
            .setAccentColor(0x9B59B6)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${e_safe} Crypto Vault`),
                new TextDisplayBuilder().setContent(`Select an address below to securely isolate and use it.`)
            );

        const groupedAddresses: Record<string, any[]> = {};
        for (const row of res.rows) {
            if (!groupedAddresses[row.coin]) groupedAddresses[row.coin] = [];
            groupedAddresses[row.coin].push(row);
        }

        for (const [coin, rows] of Object.entries(groupedAddresses)) {
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${coin}`));
            
            for (const row of rows) {
                container.addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${row.label}**\n\`${row.address}\``))
                        .setButtonAccessory(new ButtonBuilder().setCustomId(`crypt_use_${row.id}`).setLabel('Use').setStyle(ButtonStyle.Primary).setEmoji(e_link))
                );
            }
        }

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        if (res.rowCount !== null && res.rowCount > 1) {
            container.addActionRowComponents(
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId(`crypt_sel_enter_get_${page}_${safeQuery}`).setLabel('Select Mode').setStyle(ButtonStyle.Secondary).setEmoji(this.e('checklist', '☑️')),
                    new ButtonBuilder().setCustomId(`crypt_usepage_${page}_${safeQuery}`).setLabel('Use Page').setStyle(ButtonStyle.Success).setEmoji(e_box),
                    new ButtonBuilder().setCustomId(`crypt_usevault_${safeQuery}`).setLabel('Use Vault').setStyle(ButtonStyle.Primary).setEmoji(this.e('globe', '🌍'))
                )
            );
        }

        if (totalPages > 1) {
            container.addActionRowComponents(
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId(`crypt_page_get_${page - 1}_${safeQuery}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
                    new ButtonBuilder().setCustomId('dummy_page').setLabel(`Page ${page} of ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId(`crypt_page_get_${page + 1}_${safeQuery}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
                )
            );
        }

        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    private async handleRemove(interaction: ChatInputCommandInteraction) {
        const query = interaction.options.getString('query')?.toLowerCase();
        const page = interaction.options.getInteger('page') || 1;
        const limit = 5;
        const offset = (page - 1) * limit;
        const pool = this.getDatabasePool();

        let baseQuery = `FROM crypto_addresses WHERE discord_id = $1`;
        const params: any[] = [interaction.user.id];

        if (query) {
            baseQuery += ` AND (LOWER(address) LIKE $2 OR LOWER(coin) LIKE $2 OR LOWER(label) LIKE $2)`;
            params.push(`%${query}%`);
        }

        const countRes = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
        const total = parseInt(countRes.rows[0].count, 10);
        const totalPages = Math.max(1, Math.ceil(total / limit));

        if (total === 0 || page > totalPages) {
            await interaction.editReply({ content: `${this.e('cross', '❌')} No matching addresses found to remove.`, components: [] });
            return;
        }

        const res = await pool.query(`SELECT * ${baseQuery} ORDER BY coin ASC, added_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);

        const e_trash = this.e('trash', '🗑️');
        const safeQuery = query ? query.substring(0, 30) : 'none';

        const container = new ContainerBuilder()
            .setAccentColor(0xE74C3C)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${e_trash} Delete Address`),
                new TextDisplayBuilder().setContent(`Select an address below to **permanently delete** it from your vault.`)
            );

        const groupedAddresses: Record<string, any[]> = {};
        for (const row of res.rows) {
            if (!groupedAddresses[row.coin]) groupedAddresses[row.coin] = [];
            groupedAddresses[row.coin].push(row);
        }

        for (const [coin, rows] of Object.entries(groupedAddresses)) {
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${coin}`));
            
            for (const row of rows) {
                container.addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${row.label}**\n\`${row.address}\``))
                        .setButtonAccessory(new ButtonBuilder().setCustomId(`crypt_rmv_${row.id}`).setLabel('Delete').setStyle(ButtonStyle.Danger).setEmoji(e_trash))
                );
            }
        }

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        if (res.rowCount !== null && res.rowCount > 1) {
            container.addActionRowComponents(
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId(`crypt_sel_enter_rmv_${page}_${safeQuery}`).setLabel('Select Mode').setStyle(ButtonStyle.Secondary).setEmoji(this.e('checklist', '☑️')),
                    new ButtonBuilder().setCustomId(`crypt_rmvpage_${page}_${safeQuery}`).setLabel('Clear Page').setStyle(ButtonStyle.Danger).setEmoji(e_trash),
                    new ButtonBuilder().setCustomId(`crypt_rmvvault_${safeQuery}`).setLabel('Clear Vault').setStyle(ButtonStyle.Danger).setEmoji(this.e('warning', '⚠️'))
                )
            );
        }

        if (totalPages > 1) {
            container.addActionRowComponents(
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId(`crypt_page_rmv_${page - 1}_${safeQuery}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
                    new ButtonBuilder().setCustomId('dummy_page').setLabel(`Page ${page} of ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId(`crypt_page_rmv_${page + 1}_${safeQuery}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
                )
            );
        }

        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}