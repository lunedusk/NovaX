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
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { BaseCommand } from '../../../../core/bases/Command.js';

export default class CryptoCommand extends BaseCommand {
    public readonly data = new SlashCommandBuilder()
        .setName('crypto')
        .setDescription('Enterprise Cryptocurrency Address Manager')
        .setIntegrationTypes([0, 1]) // 0: Guild Install, 1: User Install
        .setContexts([0, 1, 2])      // 0: Guild, 1: Bot DM, 2: Private Channel/Group DM
        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Store a new crypto address securely.')
            .addStringOption(opt => opt.setName('address').setDescription('The exact wallet address.').setRequired(true))
            .addStringOption(opt => opt.setName('coin').setDescription('Force a coin ticker (e.g. USDT, USDC, ETH).').setRequired(false))
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
        );

    // Global Emoji Engine
    private e(name: string, fallback: string): string {
        return this.heart.assets.emoji.get(name) || fallback;
    }

    private getDatabasePool() {
        try { return this.heart.db.postgres.get('crypto'); } 
        catch { return this.heart.db.postgres.get('main'); }
    }

    private formatNetworks(netData: any): string {
        if (!netData) return 'Unknown';
        if (Array.isArray(netData)) return netData.join(', ');
        if (typeof netData === 'string') {
            try {
                const parsed = JSON.parse(netData);
                return Array.isArray(parsed) ? parsed.join(', ') : parsed;
            } catch { return netData; }
        }
        return 'Unknown';
    }

    private getEvmOptions() {
        return [
            { label: 'Ethereum (ERC20)', value: 'Ethereum', emoji: this.e('eth', '⟠') },
            { label: 'BNB Smart Chain (BEP20)', value: 'BSC', emoji: this.e('bsc', '🟡') },
            { label: 'Polygon (ERC20/MATIC)', value: 'Polygon', emoji: this.e('matic', '🟣') },
            { label: 'Base', value: 'Base', emoji: this.e('base_crypto', '🔵') },
            { label: 'Arbitrum (ERC20)', value: 'Arbitrum', emoji: this.e('arb_crypto', '🔷') },
            { label: 'Optimism (ERC20)', value: 'Optimism', emoji: this.e('op_crypto', '🔴') },
            { label: 'Avalanche (C-Chain)', value: 'Avalanche', emoji: this.e('avax_crypto', '🔺') }
        ];
    }

    private getStableOptions() {
        return [
            { label: 'USDT (Tether)', value: 'USDT', emoji: this.e('usdt', '💵') },
            { label: 'USDC (USD Coin)', value: 'USDC', emoji: this.e('usdc', '💲') },
            { label: 'Clear Stablecoins', value: 'NONE', emoji: this.e('cross', '❌') }
        ];
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

    private async handleAdd(interaction: ChatInputCommandInteraction) {
        const address = interaction.options.getString('address', true).trim();
        const inputCoin = interaction.options.getString('coin')?.toUpperCase();
        const label = interaction.options.getString('label') || 'Wallet';
        const pool = this.getDatabasePool();

        const isEVM = /^0x[a-fA-F0-9]{40}$/i.test(address);
        let detectedNetworks: string[] = [];

        if (inputCoin === 'SOL') detectedNetworks.push('Solana');
        else if (inputCoin === 'LTC') detectedNetworks.push('Litecoin');
        else if (inputCoin === 'BTC') detectedNetworks.push('Bitcoin');
        else if (inputCoin === 'TRX') detectedNetworks.push('Tron (TRC20)');
        else if (inputCoin === 'DOGE') detectedNetworks.push('Dogecoin');

        if (detectedNetworks.length === 0) {
            if (isEVM) {
                detectedNetworks.push('EVM');
            } else {
                if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/.test(address)) detectedNetworks.push('Bitcoin');
                if (/^(ltc1|[LM])[a-km-zA-HJ-NP-Z1-9]{26,33}$/.test(address)) detectedNetworks.push('Litecoin');
                if (/^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/.test(address)) detectedNetworks.push('Dogecoin');
                if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) detectedNetworks.push('Tron (TRC20)');
                if (/^r[0-9a-zA-Z]{24,34}$/.test(address)) detectedNetworks.push('XRP/Ripple');
                if (/^addr1[a-z0-9]+$/.test(address) || /^[AeD][0-9a-zA-Z]{50,}$/.test(address)) detectedNetworks.push('Cardano');
                if (/^1[0-9a-zA-Z]{46,47}$/.test(address)) detectedNetworks.push('Polkadot');
                if (/^[48][0-9a-zA-Z]{94,105}$/.test(address)) detectedNetworks.push('Monero');
                if (/^((bitcoincash:)?(q|p)[a-z0-9]{41})$/i.test(address)) detectedNetworks.push('Bitcoin Cash');
                
                if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && detectedNetworks.length === 0) {
                    detectedNetworks.push('Solana');
                }
            }
        }

        if (detectedNetworks.length === 0) detectedNetworks = ['Native/Unknown'];

        let finalCoin = inputCoin;
        if (!finalCoin) {
            const netMap: Record<string, string> = {
                'Bitcoin': 'BTC', 'Litecoin': 'LTC', 'Dogecoin': 'DOGE',
                'Tron (TRC20)': 'TRX', 'XRP/Ripple': 'XRP', 'Cardano': 'ADA',
                'Polkadot': 'DOT', 'Monero': 'XMR', 'Bitcoin Cash': 'BCH',
                'Solana': 'SOL', 'EVM': 'ETH'
            };
            finalCoin = netMap[detectedNetworks[0]] || 'UNKNOWN';
        }

        const res = await pool.query(`
            INSERT INTO crypto_addresses (discord_id, address, coin, label, networks)
            VALUES ($1, $2, $3, $4, $5) RETURNING id
        `, [interaction.user.id, address, finalCoin, label, JSON.stringify(detectedNetworks)]);
        
        const addressId = res.rows[0].id;
        const e_tick = this.e('tick', '✅');
        const e_wallet = this.e('wallet', '💳');
        const e_gear = this.e('gear', '⚙️');

        const isStableCompatible = isEVM || detectedNetworks.includes('Tron (TRC20)') || detectedNetworks.includes('Solana');
        const showStableMenu = !inputCoin && isStableCompatible;

        const container = new ContainerBuilder()
            .setAccentColor(isEVM ? 0x5865F2 : 0x2ECC71)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${isEVM ? e_wallet + ' EVM Address Detected' : e_tick + ' Address Saved'}`),
                new TextDisplayBuilder().setContent(
                    `**Label:** \`${label}\`\n` +
                    `**Coin:** \`${finalCoin}\`\n` +
                    `**Network:** \`${detectedNetworks.join(', ')}\`\n` +
                    `**Address:** \`${address}\``
                )
            );

        const components: any[] = [container];

        if (isEVM || showStableMenu) {
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${e_gear} Network Configuration`));

            if (isEVM) {
                const netSelect = new StringSelectMenuBuilder()
                    .setCustomId(`crypto_net_${addressId}`)
                    .setPlaceholder('Select EVM networks (ERC20, BEP20...)')
                    .setMinValues(1).setMaxValues(7)
                    .addOptions(this.getEvmOptions());
                container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(netSelect));
            }
            if (showStableMenu) {
                const stableSelect = new StringSelectMenuBuilder()
                    .setCustomId(`crypto_stable_${addressId}`)
                    .setPlaceholder('Optional: Associate Stablecoins (USDT/USDC)...')
                    .setMinValues(1).setMaxValues(3)
                    .addOptions(this.getStableOptions());
                container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(stableSelect));
            }
        }

        await interaction.editReply({ components, flags: MessageFlags.IsComponentsV2 });
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
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`**${row.label}**\n\`${row.address}\` - ${this.formatNetworks(row.networks)}`)
                        )
                        .setButtonAccessory(
                            new ButtonBuilder().setCustomId(`crypt_use_${row.id}`).setLabel('Use').setStyle(ButtonStyle.Primary).setEmoji(e_link)
                        )
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
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`**${row.label}**\n\`${row.address}\` - ${this.formatNetworks(row.networks)}`)
                        )
                        .setButtonAccessory(
                            new ButtonBuilder().setCustomId(`crypt_rmv_${row.id}`).setLabel('Delete').setStyle(ButtonStyle.Danger).setEmoji(e_trash)
                        )
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