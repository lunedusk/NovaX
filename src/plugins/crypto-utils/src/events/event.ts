import { 
    type ButtonInteraction, 
    type StringSelectMenuInteraction,
    MessageFlags, 
    ContainerBuilder, 
    TextDisplayBuilder, 
    SeparatorBuilder, 
    SeparatorSpacingSize,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    SectionBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { BaseEvent } from '../../../../core/bases/Event.js';

export default class CryptoEvent extends BaseEvent {
    public readonly name = 'system.ready';

    // Centralized State Cache for Select Modes
    private activeSelections = new Map<string, Set<string>>();

    public selects = new Map([
        [/^crypto_net_(\d+)$/, async (i: any, match: any) => { await this.handleNetworkSelect(i, match[1]); }],
        [/^crypto_stable_(\d+)$/, async (i: any, match: any) => { await this.handleStableSelect(i, match[1]); }]
    ]);

    public buttons = new Map([
        [/^crypt_use_(\d+)$/, async (i: any, match: any) => { await this.handleUseSingle(i, match[1]); }],
        [/^crypt_usepage_(\d+)_(.+)$/, async (i: any, match: any) => { await this.handleUsePage(i, parseInt(match[1]), match[2]); }],
        [/^crypt_usevault_(.+)$/, async (i: any, match: any) => { await this.handleUseVault(i, match[1]); }],
        
        // Dynamic Select Mode Handlers
        [/^crypt_sel_enter_([a-z]+)_(\d+)_(.+)$/, async (i: any, match: any) => { await this.handleSelectMode(i, 'enter', match[1], parseInt(match[2]), match[3]); }],
        [/^crypt_sel_exit_([a-z]+)_(\d+)_(.+)$/, async (i: any, match: any) => { await this.handleSelectMode(i, 'exit', match[1], parseInt(match[2]), match[3]); }],
        [/^crypt_sel_toggle_([a-z]+)_(\d+)_(\d+)_(.+)$/, async (i: any, match: any) => { await this.handleSelectToggle(i, match[1], match[2], parseInt(match[3]), match[4]); }],
        [/^crypt_sel_confirm_([a-z]+)_(.+)$/, async (i: any, match: any) => { await this.handleSelectConfirm(i, match[1], match[2]); }],

        [/^crypt_cpy_(\d+)$/, async (i: any, match: any) => { await this.handleCopyEphemeral(i, match[1]); }],
        
        [/^crypt_rmv_(\d+)$/, async (i: any, match: any) => { await this.handleRemoveExecute(i, match[1]); }],
        [/^crypt_rmvpage_(\d+)_(.+)$/, async (i: any, match: any) => { await this.handleRemovePage(i, parseInt(match[1]), match[2]); }],
        [/^crypt_rmvvault_(.+)$/, async (i: any, match: any) => { await this.handleRemoveVault(i, match[1]); }],
        
        [/^crypt_page_([a-z_]+)_(\d+)_(.+)$/, async (i: any, match: any) => { await this.handlePagination(i, match[1], parseInt(match[2]), match[3]); }]
    ]);

    public async execute() {}

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

    private async verifyOwnership(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<boolean> {
        const originalUser = interaction.message.interaction?.user.id;
        if (originalUser && originalUser !== interaction.user.id) {
            await interaction.reply({ 
                content: `${this.e('cross', '❌')} **Access Denied:** Only the vault owner can interact with this menu.`, 
                flags: MessageFlags.Ephemeral 
            });
            return false;
        }
        return true;
    }

    // ==========================================
    // CORE UI RE-RENDERER: SHARED ACROSS ALL MODES
    // ==========================================
    private async renderVaultPage(interaction: ButtonInteraction, mode: string, page: number, query: string) {
        const pool = this.getDatabasePool();
        const limit = 5;
        const offset = (page - 1) * limit;

        let baseQuery = `FROM crypto_addresses WHERE discord_id = $1`;
        const params: any[] = [interaction.user.id];

        if (query && query !== 'none') {
            baseQuery += ` AND (LOWER(address) LIKE $2 OR LOWER(coin) LIKE $2 OR LOWER(label) LIKE $2)`;
            params.push(`%${query}%`);
        }

        const countRes = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
        const total = parseInt(countRes.rows[0].count, 10);
        const totalPages = Math.max(1, Math.ceil(total / limit));

        const res = await pool.query(`SELECT * ${baseQuery} ORDER BY coin ASC, added_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);

        const isGet = mode === 'get';
        const isRmv = mode === 'rmv';
        const isSelGet = mode === 'sel_get';
        const isSelRmv = mode === 'sel_rmv';
        const isSel = isSelGet || isSelRmv;
        const baseMode = isSelGet || isGet ? 'get' : 'rmv';
        
        let color = 0x9B59B6;
        let e_icon = this.e('bank', '🏦');
        let title = `## ${e_icon} Crypto Vault`;
        let subtitle = `Select an address below to securely isolate and use it.`;

        if (isRmv) {
            color = 0xE74C3C;
            e_icon = this.e('trash', '🗑️');
            title = `## ${e_icon} Delete Address`;
            subtitle = `Select an address below to **permanently delete** it.`;
        } else if (isSel) {
            color = isSelGet ? 0x3498DB : 0xE74C3C;
            e_icon = this.e('checklist', '☑️');
            title = `## ${e_icon} Select Multiple`;
            subtitle = `Select the addresses you want to ${isSelGet ? 'use' : 'delete'}, then confirm.`;
        }

        const container = new ContainerBuilder()
            .setAccentColor(color)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(title), new TextDisplayBuilder().setContent(subtitle));

        const groupedAddresses: Record<string, any[]> = {};
        for (const row of res.rows) {
            if (!groupedAddresses[row.coin]) groupedAddresses[row.coin] = [];
            groupedAddresses[row.coin].push(row);
        }

        const userSet = this.activeSelections.get(interaction.user.id) || new Set<string>();

        for (const [coin, rows] of Object.entries(groupedAddresses)) {
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${coin}`));
            
            for (const row of rows) {
                const networks = this.formatNetworks(row.networks);
                let btnId = '', btnLabel = '', btnStyle = ButtonStyle.Primary, btnEmoji = '';

                if (isGet) {
                    btnId = `crypt_use_${row.id}`; btnLabel = 'Use'; btnEmoji = this.e('link', '🔗');
                } else if (isRmv) {
                    btnId = `crypt_rmv_${row.id}`; btnLabel = 'Delete'; btnStyle = ButtonStyle.Danger; btnEmoji = this.e('trash', '🗑️');
                } else if (isSel) {
                    btnId = `crypt_sel_toggle_${baseMode}_${row.id}_${page}_${query}`;
                    if (userSet.has(String(row.id))) {
                        btnLabel = 'Selected'; 
                        btnStyle = isSelGet ? ButtonStyle.Success : ButtonStyle.Danger; 
                        btnEmoji = this.e('tick', '✅');
                    } else {
                        btnLabel = 'Select'; 
                        btnStyle = ButtonStyle.Secondary; 
                        btnEmoji = this.e('box', '🔳');
                    }
                }

                container.addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${row.label}**\n\`${row.address}\` - ${networks}`))
                        .setButtonAccessory(new ButtonBuilder().setCustomId(btnId).setLabel(btnLabel).setStyle(btnStyle).setEmoji(btnEmoji))
                );
            }
        }

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        if (res.rowCount !== null && res.rowCount > 1) {
            const actionRow = new ActionRowBuilder<ButtonBuilder>();
            if (isGet) {
                actionRow.addComponents(
                    new ButtonBuilder().setCustomId(`crypt_sel_enter_get_${page}_${query}`).setLabel('Select Mode').setStyle(ButtonStyle.Secondary).setEmoji(this.e('checklist', '☑️')),
                    new ButtonBuilder().setCustomId(`crypt_usepage_${page}_${query}`).setLabel('Use Page').setStyle(ButtonStyle.Success).setEmoji(this.e('box', '📦')),
                    new ButtonBuilder().setCustomId(`crypt_usevault_${query}`).setLabel('Use Vault').setStyle(ButtonStyle.Primary).setEmoji(this.e('globe', '🌍'))
                );
            } else if (isRmv) {
                actionRow.addComponents(
                    new ButtonBuilder().setCustomId(`crypt_sel_enter_rmv_${page}_${query}`).setLabel('Select Mode').setStyle(ButtonStyle.Secondary).setEmoji(this.e('checklist', '☑️')),
                    new ButtonBuilder().setCustomId(`crypt_rmvpage_${page}_${query}`).setLabel('Clear Page').setStyle(ButtonStyle.Danger).setEmoji(this.e('trash', '🗑️')),
                    new ButtonBuilder().setCustomId(`crypt_rmvvault_${query}`).setLabel('Clear Vault').setStyle(ButtonStyle.Danger).setEmoji(this.e('warning', '⚠️'))
                );
            } else if (isSel) {
                const confirmLabel = isSelGet ? `Use (${userSet.size})` : `Delete (${userSet.size})`;
                const confirmStyle = isSelGet ? ButtonStyle.Success : ButtonStyle.Danger;
                
                actionRow.addComponents(
                    new ButtonBuilder().setCustomId(`crypt_sel_exit_${baseMode}_${page}_${query}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`crypt_sel_confirm_${baseMode}_${query}`).setLabel(confirmLabel).setStyle(confirmStyle).setEmoji(this.e('tick', '✅')).setDisabled(userSet.size === 0)
                );
            }
            container.addActionRowComponents(actionRow);
        }

        if (totalPages > 1) {
            container.addActionRowComponents(
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId(`crypt_page_${mode}_${page - 1}_${query}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
                    new ButtonBuilder().setCustomId('dummy_page').setLabel(`Page ${page} of ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId(`crypt_page_${mode}_${page + 1}_${query}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
                )
            );
        }

        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }


    // ==========================================
    // MULTI-SELECT MODE HANDLERS
    // ==========================================
    private async handleSelectMode(interaction: ButtonInteraction, action: 'enter' | 'exit', baseMode: string, page: number, query: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        await interaction.deferUpdate();

        if (action === 'enter') {
            this.activeSelections.set(interaction.user.id, new Set<string>());
            await this.renderVaultPage(interaction, `sel_${baseMode}`, page, query);
        } else {
            this.activeSelections.delete(interaction.user.id);
            await this.renderVaultPage(interaction, baseMode, page, query);
        }
    }

    private async handleSelectToggle(interaction: ButtonInteraction, baseMode: string, addressId: string, page: number, query: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        await interaction.deferUpdate();

        let userSet = this.activeSelections.get(interaction.user.id);
        if (!userSet) { userSet = new Set<string>(); this.activeSelections.set(interaction.user.id, userSet); }
        
        if (userSet.has(addressId)) userSet.delete(addressId);
        else userSet.add(addressId);

        await this.renderVaultPage(interaction, `sel_${baseMode}`, page, query);
    }

    private async handleSelectConfirm(interaction: ButtonInteraction, baseMode: string, query: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        await interaction.deferUpdate();

        const userSet = this.activeSelections.get(interaction.user.id);
        if (!userSet || userSet.size === 0) return;

        const pool = this.getDatabasePool();
        const ids = Array.from(userSet).map(id => parseInt(id, 10));
        
        // Clear state immediately to prevent memory leaks
        this.activeSelections.delete(interaction.user.id);

        if (baseMode === 'get') {
            const res = await pool.query('SELECT * FROM crypto_addresses WHERE id = ANY($1::int[]) AND discord_id = $2', [ids, interaction.user.id]);
            if (res.rowCount === 0) return;
            await this.renderActiveWalletsUI(interaction, res.rows, 'Selected Wallets');
        } else if (baseMode === 'rmv') {
            await pool.query(`DELETE FROM crypto_addresses WHERE id = ANY($1::int[]) AND discord_id = $2`, [ids, interaction.user.id]);
            const container = new ContainerBuilder()
                .setAccentColor(0x2ECC71)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## ${this.e('tick', '✅')} Addresses Deleted`),
                    new TextDisplayBuilder().setContent(`Successfully deleted **${ids.length}** selected addresses from your vault.`)
                );
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }


    // ==========================================
    // ACTION HANDLERS
    // ==========================================
    private async handlePagination(interaction: ButtonInteraction, mode: string, page: number, query: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        await interaction.deferUpdate();
        await this.renderVaultPage(interaction, mode, page, query);
    }

    private async handleUseSingle(interaction: ButtonInteraction, addressId: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        await interaction.deferUpdate();
        const pool = this.getDatabasePool();
        const res = await pool.query('SELECT * FROM crypto_addresses WHERE id = $1 AND discord_id = $2', [addressId, interaction.user.id]);
        if (res.rowCount === 0) return;
        await this.renderActiveWalletsUI(interaction, res.rows, 'Active Wallet');
    }

    private async handleUsePage(interaction: ButtonInteraction, page: number, query: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        await interaction.deferUpdate();
        const pool = this.getDatabasePool();
        const limit = 5;
        const offset = (page - 1) * limit;

        let dbQuery = `SELECT * FROM crypto_addresses WHERE discord_id = $1`;
        const params: any[] = [interaction.user.id];
        if (query && query !== 'none') {
            dbQuery += ` AND (LOWER(address) LIKE $2 OR LOWER(coin) LIKE $2 OR LOWER(label) LIKE $2)`;
            params.push(`%${query}%`);
        }
        dbQuery += ` ORDER BY coin ASC, added_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

        const res = await pool.query(dbQuery, [...params, limit, offset]);
        if (res.rowCount === 0) return;
        await this.renderActiveWalletsUI(interaction, res.rows, 'Active Wallets');
    }

    private async handleUseVault(interaction: ButtonInteraction, query: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        await interaction.deferUpdate();
        const pool = this.getDatabasePool();
        
        let dbQuery = `SELECT * FROM crypto_addresses WHERE discord_id = $1`;
        const params: any[] = [interaction.user.id];
        if (query && query !== 'none') {
            dbQuery += ` AND (LOWER(address) LIKE $2 OR LOWER(coin) LIKE $2 OR LOWER(label) LIKE $2)`;
            params.push(`%${query}%`);
        }
        dbQuery += ` ORDER BY coin ASC`;

        const res = await pool.query(dbQuery, params);
        if (res.rowCount === 0) return;

        // For large queries, send raw ephemeral text instead of components to avoid 40 item limit crash
        const text = res.rows.map(r => `**${r.label} (${r.coin})**\n\`${r.address}\``).join('\n\n');
        await interaction.followUp({ content: `## ${this.e('globe', '🌍')} Full Vault Export\n\n${text}`, flags: MessageFlags.Ephemeral });
    }

    private async renderActiveWalletsUI(interaction: ButtonInteraction, rows: any[], titleText: string) {
        const container = new ContainerBuilder()
            .setAccentColor(0x3498DB)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${this.e('link', '🔗')} ${titleText}`),
                new TextDisplayBuilder().setContent(`Tap a copy button below to securely send the address to your clipboard.`)
            );

        const groupedAddresses: Record<string, any[]> = {};
        for (const row of rows) {
            if (!groupedAddresses[row.coin]) groupedAddresses[row.coin] = [];
            groupedAddresses[row.coin].push(row);
        }

        for (const [coin, cRows] of Object.entries(groupedAddresses)) {
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${coin}`));
            for (const row of cRows) {
                container.addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${row.label}**\n\`${row.address}\` - ${this.formatNetworks(row.networks)}`))
                        .setButtonAccessory(new ButtonBuilder().setCustomId(`crypt_cpy_${row.id}`).setLabel('Copy').setStyle(ButtonStyle.Success).setEmoji(this.e('copy', '📋')))
                );
            }
        }
        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    private async handleCopyEphemeral(interaction: ButtonInteraction, addressId: string) {
        const pool = this.getDatabasePool();
        const res = await pool.query('SELECT address FROM crypto_addresses WHERE id = $1', [addressId]);
        if (res.rowCount === 0) return await interaction.reply({ content: `${this.e('cross', '❌')} Address not found.`, flags: MessageFlags.Ephemeral });
        await interaction.reply({ content: res.rows[0].address, flags: MessageFlags.Ephemeral });
    }

    private async handleRemoveExecute(interaction: ButtonInteraction, addressId: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        await interaction.deferUpdate();
        const pool = this.getDatabasePool();
        
        const res = await pool.query('SELECT label, coin, address FROM crypto_addresses WHERE id = $1 AND discord_id = $2', [addressId, interaction.user.id]);
        if (res.rowCount === 0) return await interaction.editReply({ content: `${this.e('cross', '❌')} Address not found.`, components: [] });

        await pool.query('DELETE FROM crypto_addresses WHERE id = $1 AND discord_id = $2', [addressId, interaction.user.id]);
        const data = res.rows[0];

        const container = new ContainerBuilder()
            .setAccentColor(0x2ECC71)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${this.e('tick', '✅')} Address Deleted`),
                new TextDisplayBuilder().setContent(`Successfully removed **${data.label}** (${data.coin} - \`${data.address.substring(0,6)}...\`) from your vault.`)
            );
        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    private async handleRemovePage(interaction: ButtonInteraction, page: number, query: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        await interaction.deferUpdate();
        const pool = this.getDatabasePool();
        const limit = 5;
        const offset = (page - 1) * limit;
        
        let dbQuery = `SELECT id FROM crypto_addresses WHERE discord_id = $1`;
        const params: any[] = [interaction.user.id];
        if (query && query !== 'none') {
            dbQuery += ` AND (LOWER(address) LIKE $2 OR LOWER(coin) LIKE $2 OR LOWER(label) LIKE $2)`;
            params.push(`%${query}%`);
        }
        dbQuery += ` ORDER BY coin ASC, added_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

        const selectRes = await pool.query(dbQuery, [...params, limit, offset]);
        if (selectRes.rowCount === 0) return;

        const idsToDelete = selectRes.rows.map(r => r.id);
        await pool.query(`DELETE FROM crypto_addresses WHERE id = ANY($1::int[])`, [idsToDelete]);

        const container = new ContainerBuilder()
            .setAccentColor(0x2ECC71)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${this.e('tick', '✅')} Page Cleared`),
                new TextDisplayBuilder().setContent(`Successfully deleted **${selectRes.rowCount}** addresses from this page.`)
            );
        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    private async handleRemoveVault(interaction: ButtonInteraction, query: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        await interaction.deferUpdate();
        const pool = this.getDatabasePool();
        
        let dbQuery = `DELETE FROM crypto_addresses WHERE discord_id = $1`;
        const params: any[] = [interaction.user.id];
        if (query && query !== 'none') {
            dbQuery += ` AND (LOWER(address) LIKE $2 OR LOWER(coin) LIKE $2 OR LOWER(label) LIKE $2)`;
            params.push(`%${query}%`);
        }
        
        const res = await pool.query(dbQuery, params);
        const container = new ContainerBuilder()
            .setAccentColor(0x2ECC71)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${this.e('tick', '✅')} Vault Cleared`),
                new TextDisplayBuilder().setContent(`Successfully and permanently deleted **${res.rowCount}** matching addresses from your vault.`)
            );
        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    private rebuildConfigurationUI(data: any): any[] {
        const isEVM = /^0x[a-fA-F0-9]{40}$/i.test(data.address);
        const nets = this.formatNetworks(data.networks);
        const isStableCompatible = isEVM || nets.includes('Tron') || nets.includes('Solana');

        const e_tick = this.e('tick', '✅');
        const e_gear = this.e('gear', '⚙️');
        
        const container = new ContainerBuilder()
            .setAccentColor(0x2ECC71) 
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${e_tick} Configuration Updated`),
                new TextDisplayBuilder().setContent(`**Label:** \`${data.label}\`\n**Coin:** \`${data.coin}\`\n**Networks:** \`${nets}\`\n**Address:** \`${data.address}\``)
            );

        if (isEVM || isStableCompatible) {
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${e_gear} Network Configuration`));

            if (isEVM) {
                const netSelect = new StringSelectMenuBuilder()
                    .setCustomId(`crypto_net_${data.id}`)
                    .setPlaceholder('Update EVM networks (ERC20, BEP20...)')
                    .setMinValues(1).setMaxValues(7)
                    .addOptions(this.getEvmOptions());
                container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(netSelect));
            }

            if (isStableCompatible) {
                const stableSelect = new StringSelectMenuBuilder()
                    .setCustomId(`crypto_stable_${data.id}`)
                    .setPlaceholder('Update Stablecoins (USDT/USDC)...')
                    .setMinValues(1).setMaxValues(3)
                    .addOptions(this.getStableOptions());
                container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(stableSelect));
            }
        }
        return [container];
    }

    private async handleNetworkSelect(interaction: StringSelectMenuInteraction, addressId: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        await interaction.deferUpdate();
        const pool = this.getDatabasePool();
        const selectedNetworks = interaction.values;

        const checkRes = await pool.query('SELECT coin FROM crypto_addresses WHERE id = $1', [addressId]);
        const parts = checkRes.rows[0].coin.split(' / ');
        const existingStables = parts.filter((p: string) => p === 'USDT' || p === 'USDC');

        const tickerMap: Record<string, string> = {
            'Ethereum': 'ETH', 'BSC': 'BNB', 'Polygon': 'POL',
            'Base': 'ETH', 'Arbitrum': 'ARB', 'Optimism': 'OP', 'Avalanche': 'AVAX'
        };
        const mappedTickers = selectedNetworks.map(net => tickerMap[net] || net);
        const uniqueBaseTickers = Array.from(new Set(mappedTickers));

        const finalCoin = [...uniqueBaseTickers, ...existingStables].join(' / ');
        await pool.query('UPDATE crypto_addresses SET networks = $1, coin = $2 WHERE id = $3', [JSON.stringify(selectedNetworks), finalCoin, addressId]);
        
        const res = await pool.query('SELECT * FROM crypto_addresses WHERE id = $1', [addressId]);
        await interaction.editReply({ components: this.rebuildConfigurationUI(res.rows[0]), flags: MessageFlags.IsComponentsV2 });
    }

    private async handleStableSelect(interaction: StringSelectMenuInteraction, addressId: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        await interaction.deferUpdate();
        const pool = this.getDatabasePool();
        const rawSelection = interaction.values;
        const selectedStables = rawSelection.includes('NONE') ? [] : rawSelection.filter(s => s === 'USDT' || s === 'USDC');

        const checkRes = await pool.query('SELECT coin FROM crypto_addresses WHERE id = $1', [addressId]);
        const parts = checkRes.rows[0].coin.split(' / ');
        const nonStables = parts.filter((p: string) => p !== 'USDT' && p !== 'USDC');

        const newCoinArr = Array.from(new Set([...nonStables, ...selectedStables]));
        const finalCoin = newCoinArr.length > 0 ? newCoinArr.join(' / ') : 'UNKNOWN';

        await pool.query('UPDATE crypto_addresses SET coin = $1 WHERE id = $2', [finalCoin, addressId]);
        const res = await pool.query('SELECT * FROM crypto_addresses WHERE id = $1', [addressId]);
        await interaction.editReply({ components: this.rebuildConfigurationUI(res.rows[0]), flags: MessageFlags.IsComponentsV2 });
    }
}