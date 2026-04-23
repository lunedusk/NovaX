import { 
    type ButtonInteraction, 
    MessageFlags, 
    ContainerBuilder, 
    TextDisplayBuilder, 
    SeparatorBuilder, 
    SeparatorSpacingSize,
    ActionRowBuilder,
    SectionBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { BaseEvent } from '../../../../core/bases/Event.js';
import { getLogger } from '../../../../core/utils/logger.js';

export default class CryptoEvent extends BaseEvent {
    public readonly name = 'system.ready';
    private log = getLogger('CryptoEvent');
    
    // Internal States
    private activeSelections = new Map<string, Set<string>>();
    private publicExportCache = new Map<string, { ids: number[], expiry: number }>();

    public buttons = new Map([
        // Get Commands (Private to owner)
        [/^crypt_use_(\d+)$/, async (i: any, match: any) => { await this.handleUseSingle(i, match[1]); }],
        [/^crypt_usepage_(\d+)_(.+)$/, async (i: any, match: any) => { await this.handleUsePage(i, parseInt(match[1]), match[2]); }],
        [/^crypt_usevault_(.+)$/, async (i: any, match: any) => { await this.handleUseVault(i, match[1]); }],
        
        // Select Modes (Private to owner)
        [/^crypt_sel_enter_([a-z]+)_(\d+)_(.+)$/, async (i: any, match: any) => { await this.handleSelectMode(i, 'enter', match[1], parseInt(match[2]), match[3]); }],
        [/^crypt_sel_exit_([a-z]+)_(\d+)_(.+)$/, async (i: any, match: any) => { await this.handleSelectMode(i, 'exit', match[1], parseInt(match[2]), match[3]); }],
        [/^crypt_sel_toggle_([a-z]+)_(\d+)_(\d+)_(.+)$/, async (i: any, match: any) => { await this.handleSelectToggle(i, match[1], match[2], parseInt(match[3]), match[4]); }],
        [/^crypt_sel_confirm_([a-z]+)_(.+)$/, async (i: any, match: any) => { await this.handleSelectConfirm(i, match[1], match[2]); }],

        // Copy (Publicly Accessible)
        [/^crypt_cpy_(\d+)$/, async (i: any, match: any) => { await this.handleCopyEphemeral(i, match[1]); }],
        
        // Public Paginated Views (Publicly Accessible)
        [/^crypt_pub_vault_(\d+)_(.+)_(.+)$/, async (i: any, match: any) => { await this.renderPublicVaultExport(i, parseInt(match[1]), match[2], match[3]); }],
        [/^crypt_pub_sel_(\d+)_(.+)$/, async (i: any, match: any) => { await this.renderPublicSelectExport(i, parseInt(match[1]), match[2]); }],

        // Remove Commands (Private to owner)
        [/^crypt_rmv_(\d+)$/, async (i: any, match: any) => { await this.handleRemoveExecute(i, match[1]); }],
        [/^crypt_rmvpage_(\d+)_(.+)$/, async (i: any, match: any) => { await this.handleRemovePage(i, parseInt(match[1]), match[2]); }],
        [/^crypt_rmvvault_(.+)$/, async (i: any, match: any) => { await this.handleRemoveVault(i, match[1]); }],
        
        // Base Vault Pagination (Private to owner)
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

    private async verifyOwnership(interaction: ButtonInteraction): Promise<boolean> {
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
    // PUBLIC EXPORT RENDERING
    // ==========================================
    private async renderPublicUI(interaction: ButtonInteraction, rows: any[], titleText: string, pageComponents: ActionRowBuilder<ButtonBuilder> | null) {
        const container = new ContainerBuilder()
            .setAccentColor(0x3498DB)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${this.e('globe', '🌍')} ${titleText}`),
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
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${row.label}**\n\`${row.address}\``))
                        .setButtonAccessory(new ButtonBuilder().setCustomId(`crypt_cpy_${row.id}`).setLabel('Copy').setStyle(ButtonStyle.Success).setEmoji(this.e('copy', '📋')))
                );
            }
        }
        
        if (pageComponents) container.addActionRowComponents(pageComponents);
        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    private async renderPublicVaultExport(interaction: ButtonInteraction, page: number, query: string, ownerId: string) {
        await interaction.deferUpdate();
        const pool = this.getDatabasePool();
        const limit = 5;
        const offset = (page - 1) * limit;

        let baseQuery = `FROM crypto_addresses WHERE discord_id = $1`;
        const params: any[] = [ownerId];
        if (query && query !== 'none') {
            baseQuery += ` AND (LOWER(address) LIKE $2 OR LOWER(coin) LIKE $2 OR LOWER(label) LIKE $2)`;
            params.push(`%${query}%`);
        }

        const countRes = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
        const total = parseInt(countRes.rows[0].count, 10);
        const totalPages = Math.max(1, Math.ceil(total / limit));

        const res = await pool.query(`SELECT * ${baseQuery} ORDER BY coin ASC, added_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);
        
        let navRow = null;
        if (totalPages > 1) {
            navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`crypt_pub_vault_${page - 1}_${query}_${ownerId}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
                new ButtonBuilder().setCustomId('dummy_page').setLabel(`Page ${page} of ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId(`crypt_pub_vault_${page + 1}_${query}_${ownerId}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
            );
        }

        await this.renderPublicUI(interaction, res.rows, 'Shared Vault Export', navRow);
    }

    private async renderPublicSelectExport(interaction: ButtonInteraction, page: number, exportId: string) {
        await interaction.deferUpdate();

        // 1-Hour Ephemeral Cache Cleanup Check
        const now = Date.now();
        for (const [key, val] of this.publicExportCache.entries()) {
            if (now > val.expiry) this.publicExportCache.delete(key);
        }

        const exportData = this.publicExportCache.get(exportId);
        if (!exportData) {
            return await interaction.followUp({ content: `${this.e('cross', '❌')} This shared selection has expired (1 hour limit).`, flags: MessageFlags.Ephemeral });
        }

        const pool = this.getDatabasePool();
        const limit = 5;
        const total = exportData.ids.length;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const offset = (page - 1) * limit;
        const pageIds = exportData.ids.slice(offset, offset + limit);

        const res = await pool.query('SELECT * FROM crypto_addresses WHERE id = ANY($1::int[]) ORDER BY coin ASC', [pageIds]);
        
        let navRow = null;
        if (totalPages > 1) {
            navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`crypt_pub_sel_${page - 1}_${exportId}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
                new ButtonBuilder().setCustomId('dummy_page').setLabel(`Page ${page} of ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId(`crypt_pub_sel_${page + 1}_${exportId}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
            );
        }

        await this.renderPublicUI(interaction, res.rows, 'Shared Selection', navRow);
    }


    // ==========================================
    // CORE UI RE-RENDERER: BASE VAULT
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
        const isBal = mode === 'bal';
        const isSelGet = mode === 'sel_get';
        const isSelRmv = mode === 'sel_rmv';
        const isSelBal = mode === 'sel_bal';
        const isSel = isSelGet || isSelRmv || isSelBal;
        
        let baseMode = 'get';
        if (isRmv || isSelRmv) baseMode = 'rmv';
        if (isBal || isSelBal) baseMode = 'bal';
        
        let color = 0x9B59B6;
        let e_icon = this.e('bank', '🏦');
        let title = `## ${e_icon} Crypto Vault`;
        let subtitle = `Select an address below to securely isolate and use it.`;

        if (isRmv || isSelRmv) {
            color = 0xE74C3C;
            e_icon = this.e('trash', '🗑️');
            title = `## ${e_icon} Delete Address`;
            subtitle = isSel ? `Select addresses to **permanently delete**, then confirm.` : `Select an address below to **permanently delete** it.`;
        } else if (isBal || isSelBal) {
            color = 0xF1C40F; 
            e_icon = this.e('money', '💵');
            title = `## ${e_icon} Balance Scanner`;
            subtitle = isSel ? `Select addresses to **scan balances**, then confirm.` : `Select an address below to check its live balance.`;
        } else if (isSel) {
            color = 0x3498DB;
            e_icon = this.e('checklist', '☑️');
            title = `## ${e_icon} Select Multiple`;
            subtitle = `Select the addresses you want to use, then confirm.`;
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
                let btnId = '', btnLabel = '', btnStyle = ButtonStyle.Primary, btnEmoji = '';

                if (isGet) {
                    btnId = `crypt_use_${row.id}`; btnLabel = 'Use'; btnEmoji = this.e('link', '🔗');
                } else if (isRmv) {
                    btnId = `crypt_rmv_${row.id}`; btnLabel = 'Delete'; btnStyle = ButtonStyle.Danger; btnEmoji = this.e('trash', '🗑️');
                } else if (isBal) {
                    btnId = `crypt_bal_${row.id}`; btnLabel = 'Check Bal'; btnStyle = ButtonStyle.Primary; btnEmoji = this.e('money', '💵');
                } else if (isSel) {
                    btnId = `crypt_sel_toggle_${baseMode}_${row.id}_${page}_${query}`;
                    if (userSet.has(String(row.id))) {
                        btnLabel = 'Selected'; 
                        btnStyle = isSelGet ? ButtonStyle.Success : (isSelBal ? ButtonStyle.Primary : ButtonStyle.Danger); 
                        btnEmoji = this.e('tick', '✅');
                    } else {
                        btnLabel = 'Select'; 
                        btnStyle = ButtonStyle.Secondary; 
                        btnEmoji = this.e('box', '🔳');
                    }
                }

                container.addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${row.label}**\n\`${row.address}\``))
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
            } else if (isBal) {
                actionRow.addComponents(
                    new ButtonBuilder().setCustomId(`crypt_sel_enter_bal_${page}_${query}`).setLabel('Select Mode').setStyle(ButtonStyle.Secondary).setEmoji(this.e('checklist', '☑️')),
                    new ButtonBuilder().setCustomId(`crypt_balpage_${page}_${query}`).setLabel('Scan Page').setStyle(ButtonStyle.Success).setEmoji(this.e('box', '📦')),
                    new ButtonBuilder().setCustomId(`crypt_balvault_${query}`).setLabel('Scan Vault').setStyle(ButtonStyle.Primary).setEmoji(this.e('globe', '🌍'))
                );
            } else if (isSel) {
                let confirmLabel = `Use (${userSet.size})`;
                let confirmStyle = ButtonStyle.Success;
                if (isSelRmv) { confirmLabel = `Delete (${userSet.size})`; confirmStyle = ButtonStyle.Danger; }
                if (isSelBal) { confirmLabel = `Scan (${userSet.size})`; confirmStyle = ButtonStyle.Primary; }
                
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
        
        const userSet = this.activeSelections.get(interaction.user.id);
        if (!userSet || userSet.size === 0) return await interaction.deferUpdate();

        const pool = this.getDatabasePool();
        const ids = Array.from(userSet).map(id => parseInt(id, 10));
        this.activeSelections.delete(interaction.user.id); // Clear local state

        if (baseMode === 'get') {
            // Store selection in the 1-hour Public Cache for Paginated Sharing
            const exportId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
            this.publicExportCache.set(exportId, { ids, expiry: Date.now() + 3600000 }); // 1 Hour
            await this.renderPublicSelectExport(interaction, 1, exportId);

        } else if (baseMode === 'rmv') {
            await interaction.deferUpdate();
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

    private async handlePagination(interaction: ButtonInteraction, mode: string, page: number, query: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        await interaction.deferUpdate();
        await this.renderVaultPage(interaction, mode, page, query);
    }

    // ==========================================
    // GET ACTIONS
    // ==========================================
    private async handleUseSingle(interaction: ButtonInteraction, addressId: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        await interaction.deferUpdate();
        const pool = this.getDatabasePool();
        const res = await pool.query('SELECT * FROM crypto_addresses WHERE id = $1 AND discord_id = $2', [addressId, interaction.user.id]);
        if (res.rowCount === 0) return;
        
        // Exporting Single Item is simple enough to bypass Cache
        await this.renderPublicUI(interaction, res.rows, 'Active Wallet', null);
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
        
        await this.renderPublicUI(interaction, res.rows, 'Active Wallets', null);
    }

    private async handleUseVault(interaction: ButtonInteraction, query: string) {
        if (!(await this.verifyOwnership(interaction))) return;
        
        // Push full vault export through the paginated Public Vault Handler
        await this.renderPublicVaultExport(interaction, 1, query, interaction.user.id);
    }

    private async handleCopyEphemeral(interaction: ButtonInteraction, addressId: string) {
        const pool = this.getDatabasePool();
        // Public copy! No owner check.
        const res = await pool.query('SELECT address FROM crypto_addresses WHERE id = $1', [addressId]);
        if (res.rowCount === 0) return await interaction.reply({ content: `${this.e('cross', '❌')} Address not found.`, flags: MessageFlags.Ephemeral });
        await interaction.reply({ content: res.rows[0].address, flags: MessageFlags.Ephemeral });
    }

    // ==========================================
    // REMOVE ACTIONS
    // ==========================================
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
}