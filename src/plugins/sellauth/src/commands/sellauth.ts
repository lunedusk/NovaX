import { 
    type ChatInputCommandInteraction, 
    type AutocompleteInteraction,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    MessageFlags,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    type ModalSubmitInteraction,
    LabelBuilder
} from 'discord.js';
import * as nodemailer from 'nodemailer';
import { BaseCommand } from '../../../../core/bases/Command.js'; 
import { type IHeart } from '../../../../core/heart/index.js';
import { type SellAuthConfig } from '../../index.js'; 
import { Cooldown } from '../../../../core/decorators/cooldown.js';

interface SellAuthProduct { id: number; name: string; }
interface OTPData { code: string; email: string; expires: number; }

export default class SellAuthCommand extends BaseCommand {
    private productCache: SellAuthProduct[] | null = null;
    private cacheExpiry: number = 0;
    
    private otpCache = new Map<string, OTPData>();

    public readonly config = {
        autoDefer: false,
    };

    public readonly data = new SlashCommandBuilder()
        .setName('sellauth')
        .setDescription('SellAuth Enterprise Management')
        .addSubcommand(sub => sub
            .setName('link')
            .setDescription('Link your email to your Discord account for automated role & product delivery.')
            .addStringOption(option => option
                .setName('email')
                .setDescription('The exact email address you use at checkout.')
                .setRequired(true)
            )
        )
        .addSubcommand(sub => sub
            .setName('profile')
            .setDescription('View your linked SellAuth profile, purchase history, and statistics.')
        )
        .addSubcommand(sub => sub
            .setName('privacy')
            .setDescription('Toggle anonymous mode for your public reviews.')
        )
        .addSubcommandGroup(group => group
            .setName('admin')
            .setDescription('Administrative tools for SellAuth')
            .addSubcommand(sub => sub
                .setName('setinstruction')
                .setDescription('Set automated delivery instructions for a product.')
                .addStringOption(option => option.setName('product').setDescription('Search and select the SellAuth product.').setRequired(true).setAutocomplete(true))
                .addStringOption(option => option.setName('instruction').setDescription('The delivery message. Use \\n for line breaks.').setRequired(true))
            )
            .addSubcommand(sub => sub
                .setName('lookup')
                .setDescription('View an unmasked customer dossier by User or Email.')
                .addUserOption(option => option
                    .setName('target_user')
                    .setDescription('Lookup by Discord User.')
                )
                .addStringOption(option => option
                    .setName('target_email')
                    .setDescription('Lookup by exact Email Address.')
                )
            )
            .addSubcommand(sub => sub
                .setName('getinvoice')
                .setDescription('Fetch full details of a specific SellAuth invoice.')
                .addStringOption(option => option.setName('invoice_id').setDescription('The Invoice ID or UUID to lookup.').setRequired(true))
            )
            .addSubcommand(sub => sub
                .setName('audit')
                .setDescription('Global identity audit: View linking statistics and a directory of verified users.')
                .addIntegerOption(option => option.setName('page').setDescription('The page number to view.').setMinValue(1))
            )
        );

    constructor(heart: IHeart) {
        super(heart);
    }

    public async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const config = this.heart.assets.config.get('sellauth') as unknown as SellAuthConfig;

        if (!config || !config.enabled || !config.sellauthApiKey || !config.shopId) {
            return await interaction.respond([]);
        }

        try {
            if (!this.productCache || Date.now() > this.cacheExpiry) {
                const response = await fetch(`https://api.sellauth.com/v1/shops/${config.shopId}/products`, {
                    headers: {
                        'Authorization': `Bearer ${config.sellauthApiKey}`,
                        'Accept': 'application/json'
                    }
                });

                if (response.ok) {
                    const json = await response.json();
                    this.productCache = (json.data || json).map((p: any) => ({ id: p.id, name: p.name }));
                    this.cacheExpiry = Date.now() + (5 * 60 * 1000); 
                } else {
                    this.productCache = [];
                }
            }

            const filtered = (this.productCache || [])
                .filter(p => p.name.toLowerCase().includes(focusedValue))
                .slice(0, 25)
                .map(p => ({ name: p.name.substring(0, 100), value: String(p.id) }));

            await interaction.respond(filtered);

        } catch (error) {
            this.log.error(`Autocomplete fetch failed:`, error);
            await interaction.respond([]);
        }
    }

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();
        const group = interaction.options.getSubcommandGroup();

        if (group === 'admin') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const config = this.heart.assets.config.get('sellauth') as unknown as SellAuthConfig;
            if (config.roles?.admin && !interaction.guild?.members.cache.get(interaction.user.id)?.roles.cache.has(config.roles.admin)) {
                await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} You do not possess the required SellAuth Admin role.`);
                return;
            }

            if (subcommand === 'setinstruction') await this.handleSetInstruction(interaction);
            else if (subcommand === 'getinvoice') await this.handleGetInvoice(interaction);
            else if (subcommand === 'lookup') await this.handleAdminLookup(interaction);
            else if (subcommand === 'audit') await this.handleAdminAudit(interaction);
        } 
        
        else if (subcommand === 'link') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await this.handleLink(interaction);
        }
        else if (subcommand === 'profile') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await this.handleProfile(interaction);
        }
        else if (subcommand === 'privacy') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await this.handlePrivacy(interaction);
        }
    }

    private async handleLink(interaction: ChatInputCommandInteraction): Promise<void> {
        const email = interaction.options.getString('email', true).trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
            await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} **Invalid Format:** Please provide a valid email address.`);
            return;
        }

        try {
            const host = this.heart.assets.secrets.get('SmtpHost');
            const user = this.heart.assets.secrets.get('SmtpUser');
            const pass = this.heart.assets.secrets.get('SmtpPass');
            const port = parseInt(this.heart.assets.secrets.get('SmtpPort'));

            if (!host || !user || !pass || isNaN(port)) {
                throw new Error("Missing variables");
            }
        } catch (err) {
            this.log.error(`[SellAuth] User ${interaction.user.tag} attempted to link, but SMTP is not configured.`);
            await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} **Service Unavailable:** Email verification is currently disabled by administrators (SMTP not configured).`);
            return;
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        this.otpCache.set(interaction.user.id, { code, email, expires: Date.now() + (5 * 60 * 1000) });

        try {
            await this.sendOtpEmail(email, code, interaction.user.username);
            const emoji_mail = this.heart.assets.emoji.get('mail') || '📧';
            const btnId = `btn_otp_${interaction.id}`;

            const container = new ContainerBuilder()
                .setAccentColor(0x3498DB)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `## ${emoji_mail} Verification Required\n` +
                        `We have securely dispatched a One-Time Password to \`${email}\`.\n\n` +
                        `*This code expires in 5 minutes. Check your spam folder if you do not see it.*`
                    )
                );

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(btnId)
                    .setStyle(ButtonStyle.Success)
                    .setLabel('Enter OTP')
            );
            container.addActionRowComponents(row);

            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });

            const collector = interaction.channel?.createMessageComponentCollector({
                filter: i => i.customId === btnId && i.user.id === interaction.user.id,
                time: 5 * 60 * 1000 
            });

            collector?.on('collect', async (btnInteraction) => {
                const modalId = `modal_otp_${interaction.id}`;
                
                const otpInput = new TextInputBuilder()
                    .setCustomId('otp_input')
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(6)
                    .setMaxLength(6)
                    .setRequired(true)
                    .setPlaceholder('e.g. 123456');

                const otpLabel = new LabelBuilder()
                    .setLabel('Enter 6-Digit Code')
                    .setTextInputComponent(otpInput);

                const modal = new ModalBuilder()
                    .setCustomId(modalId)
                    .setTitle('Secure Verification')
                    .addLabelComponents(otpLabel); 
                
                await btnInteraction.showModal(modal);

                try {
                    const submitInteraction = await btnInteraction.awaitModalSubmit({
                        filter: i => i.customId === modalId && i.user.id === interaction.user.id,
                        time: 60000 
                    });

                    await this.processOtpSubmission(submitInteraction);
                } catch (err) {
                }
            });

        } catch (error: any) {
            this.log.error('SMTP Delivery Failed:', error);
            await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} **Mail Server Error:** Unable to dispatch email. Please notify administrators.`);
        }
    }

    @Cooldown('sellauth_privacy', { limit: 1, windowMs: 60000 })
    private async handlePrivacy(interaction: ChatInputCommandInteraction): Promise<void> {
        const pool = this.getDatabasePool();

        try {
            try {
                await pool.query(`ALTER TABLE sellauth_users ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT false;`);
            } catch (e) {  }

            const userRes = await pool.query('SELECT is_anonymous FROM sellauth_users WHERE discord_id = $1', [interaction.user.id]);
            
            if (userRes.rowCount === 0) {
                await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} **No Account Linked:** Please link your email first using \`/sellauth link\`.`);
                return;
            }

            const currentState = userRes.rows[0].is_anonymous;
            const newState = !currentState;

            await pool.query('UPDATE sellauth_users SET is_anonymous = $1 WHERE discord_id = $2', [newState, interaction.user.id]);

            const emoji_shield = this.heart.assets.emoji.get('shield') || '🛡️';
            const stateText = newState ? '**Anonymous** (Your ID will be hidden on reviews)' : '**Public** (Your ID will be visible on reviews)';

            const container = new ContainerBuilder()
                .setAccentColor(newState ? 0x9B59B6 : 0x3498DB)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## ${emoji_shield} Privacy Settings Updated\nYour review visibility is now set to: ${stateText}`)
                );

            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        } catch (error: any) {
            this.log.error(`Privacy Toggle Error:`, error);
            await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} **Database Error:** \`${error.message}\``);
        }
    }

    private async handleAdminAudit(interaction: ChatInputCommandInteraction): Promise<void> {
        const pool = this.getDatabasePool();
        const page = interaction.options.getInteger('page') || 1;
        const limit = 10;
        const offset = (page - 1) * limit;

        try {
            const statsRes = await pool.query(`
                SELECT 
                    (SELECT COUNT(*) FROM sellauth_users) as total_linked,
                    (SELECT COUNT(DISTINCT discord_id) FROM sellauth_invoices) as total_customers
            `);

            const totalLinked = parseInt(statsRes.rows[0].total_linked, 10);
            const totalCustomers = parseInt(statsRes.rows[0].total_customers, 10);
            const totalMembers = interaction.guild?.memberCount || 0;
            
            const linkRate = totalMembers > 0 ? ((totalLinked / totalMembers) * 100).toFixed(1) : '0';
            const coverageRate = totalCustomers > 0 ? ((totalLinked / totalCustomers) * 100).toFixed(1) : '0';

            const listRes = await pool.query(`
                SELECT discord_id, email, linked_at 
                FROM sellauth_users 
                ORDER BY linked_at DESC 
                LIMIT $1 OFFSET $2
            `, [limit, offset]);

            const totalPages = Math.ceil(totalLinked / limit);

            const emoji_audit = this.heart.assets.emoji.get('audit') || '📊';
            const emoji_user = this.heart.assets.emoji.get('user') || '👤';

            const container = new ContainerBuilder()
                .setAccentColor(0x5865F2)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## ${emoji_audit} SellAuth Identity Audit`)
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### Global Statistics\n` +
                    `**Verified Identities:** \`${totalLinked}\` users\n` +
                    `**Guild Coverage:** \`${linkRate}%\` of members\n` +
                    `**Customer Conversion:** \`${coverageRate}%\` linked`
                )
            );

            let directoryText = '';
            if (listRes.rowCount === 0) {
                directoryText = '*No linked users found on this page.*';
            } else {
                for (const row of listRes.rows) {
                    const ts = Math.floor(new Date(row.linked_at).getTime() / 1000);
                    directoryText += `• <@${row.discord_id}> | \`${row.email}\` (<t:${ts}:R>)\n`;
                }
            }

            container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`### ${emoji_user} Verified Directory (Page ${page}/${totalPages || 1})\n${directoryText}`)
                );

            if (totalPages > 1) {
                const row = new ActionRowBuilder<ButtonBuilder>();
                
                if (page > 1) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`sa_audit_prev_${page - 1}`)
                            .setLabel('Previous')
                            .setStyle(ButtonStyle.Secondary)
                    );
                }

                if (page < totalPages) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`sa_audit_next_${page + 1}`)
                            .setLabel('Next')
                            .setStyle(ButtonStyle.Secondary)
                    );
                }

                if (row.components.length > 0) {
                    container.addActionRowComponents(row);
                }
            }

            await interaction.editReply({ 
                components: [container],
                flags: MessageFlags.IsComponentsV2 
            });

        } catch (error: any) {
            this.log.error(`Admin Audit Error:`, error);
            await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} **Audit Failure:** \`${error.message}\``);
        }
    }

    private async handleAdminLookup(interaction: ChatInputCommandInteraction): Promise<void> {
        const targetUser = interaction.options.getUser('target_user');
        const targetEmail = interaction.options.getString('target_email')?.trim().toLowerCase();

        if (!targetUser && !targetEmail) {
            await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} **Invalid Query:** You must provide either a \`target_user\` or a \`target_email\` to perform a lookup.`);
            return;
        }

        const config = this.heart.assets.config.get('sellauth') as unknown as SellAuthConfig;
        const pool = this.getDatabasePool();

        try {
            let userQuery = '';
            let queryParams: any[] = [];

            if (targetUser) {
                userQuery = 'SELECT discord_id, email, linked_at FROM sellauth_users WHERE discord_id = $1';
                queryParams = [targetUser.id];
            } else {
                userQuery = 'SELECT discord_id, email, linked_at FROM sellauth_users WHERE email = $1';
                queryParams = [targetEmail];
            }

            const userRes = await pool.query(userQuery, queryParams);
            
            if (userRes.rowCount === 0) {
                const searchParam = targetUser ? targetUser.tag : targetEmail;
                await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} **No Record Found:** The query \`${searchParam}\` does not exist in the identity database.`);
                return;
            }

            const linkedEmail = userRes.rows[0].email;
            const targetDiscordId = userRes.rows[0].discord_id;
            const linkedAt = new Date(userRes.rows[0].linked_at);
            const linkedTs = Math.floor(linkedAt.getTime() / 1000);

            const cursorRes = await pool.query('SELECT MAX(invoice_id) as last_id, COUNT(*) as local_count FROM sellauth_invoices WHERE discord_id = $1', [targetDiscordId]);
            const lastInvoiceId = cursorRes.rows[0].last_id || 0;
            const localCount = parseInt(cursorRes.rows[0].local_count || '0', 10);
            const fetchLimit = localCount === 0 ? '100' : '15';

            const apiParams = new URLSearchParams({
                'email': linkedEmail,
                'statuses[0]': 'completed',
                'per_page': fetchLimit,
                'with': 'items',
                'orderColumn': 'completed_at',
                'orderDirection': 'desc'
            });

            const response = await fetch(`https://api.sellauth.com/v1/shops/${config.shopId}/invoices?${apiParams.toString()}`, {
                headers: { 'Authorization': `Bearer ${config.sellauthApiKey}`, 'Accept': 'application/json' }
            });

            if (response.ok) {
                const json = await response.json();
                for (const inv of (json.data || [])) {
                    if (inv.id <= lastInvoiceId) break; 
                    const price = parseFloat(inv.paid_usd || inv.price_usd || inv.price || '0');
                    await pool.query(`
                        INSERT INTO sellauth_invoices (invoice_id, discord_id, price_usd, items_json, completed_at)
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (invoice_id) DO NOTHING
                    `, [ inv.id, targetDiscordId, isNaN(price) ? 0 : price, JSON.stringify(inv.items || []), inv.completed_at ]);
                }
            }

            const statsRes = await pool.query(`SELECT COUNT(*) as total_orders, SUM(price_usd) as total_spent FROM sellauth_invoices WHERE discord_id = $1`, [targetDiscordId]);
            const totalLifetimeOrders = parseInt(statsRes.rows[0].total_orders || '0', 10);
            const totalSpent = parseFloat(statsRes.rows[0].total_spent || '0');

            const recentRes = await pool.query(`SELECT invoice_id, items_json FROM sellauth_invoices WHERE discord_id = $1 ORDER BY completed_at DESC LIMIT 5`, [targetDiscordId]);
            const recentItems: string[] = [];
            
            for (const row of recentRes.rows) {
                const items = row.items_json || [];
                for (const item of items) {
                    const variant = item.variant?.name ? ` \`(${item.variant.name})\`` : '';
                    recentItems.push(`• **${item.product?.name || 'Unknown'}**${variant} (Inv: \`${row.invoice_id}\`)`);
                }
            }

            const emoji_system = this.heart.assets.emoji.get('system') || '🛡️';
            const emoji_money = this.heart.assets.emoji.get('money') || '💵';
            const emoji_box = this.heart.assets.emoji.get('box') || '📦';
            
            const container = new ContainerBuilder()
                .setAccentColor(0xE74C3C)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## ${emoji_system} Administrator Dossier`)
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### Identity Data\n` +
                    `**Email:** \`${linkedEmail}\`\n` +
                    `**Discord User:** <@${targetDiscordId}> (\`${targetDiscordId}\`)\n` +
                    `**Linked Record:** <t:${linkedTs}:f>`
                ),
                new TextDisplayBuilder().setContent(
                    `### ${emoji_money} Lifetime Value (LTV)\n` +
                    `**Gross Spent:** \`$${totalSpent.toFixed(2)} USD\`\n` +
                    `**Verified Orders:** \`${totalLifetimeOrders}\``
                )
            );

            const recentText = recentItems.length > 0 ? recentItems.join('\n') : '*No verified acquisitions found in database.*';
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`### ${emoji_box} Recent Acquisitions\n${recentText}`)
                );

            await interaction.editReply({ 
                components: [container],
                flags: MessageFlags.IsComponentsV2 
            });

        } catch (error: any) {
            this.log.error(`Admin Lookup Error for ${interaction.user.id}:`, error);
            await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} **Database Error:** \`${error.message}\``);
        }
    }

    private async processOtpSubmission(interaction: ModalSubmitInteraction): Promise<void> {
        await interaction.deferUpdate();

        const inputCode = interaction.fields.getTextInputValue('otp_input');
        const session = this.otpCache.get(interaction.user.id);

        if (!session) {
            await interaction.editReply({ content: '❌ Your verification session has expired. Please run the command again.', components: [] });
            return;
        }

        if (Date.now() > session.expires) {
            this.otpCache.delete(interaction.user.id);
            await interaction.editReply({ content: '❌ The OTP has expired. Please run the command again.', components: [] });
            return;
        }

        if (session.code !== inputCode) {
            await interaction.followUp({ content: '❌ Incorrect Code. Try clicking the button again.', flags: MessageFlags.Ephemeral });
            return;
        }

        try {
            const pool = this.getDatabasePool();
            
            await pool.query(`
                CREATE TABLE IF NOT EXISTS sellauth_users (
                    discord_id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            await pool.query(`
                INSERT INTO sellauth_users (discord_id, email, linked_at) 
                VALUES ($1, $2, NOW()) 
                ON CONFLICT (discord_id) 
                DO UPDATE SET email = $2, linked_at = NOW()
            `, [interaction.user.id, session.email]);

            this.otpCache.delete(interaction.user.id);

            const emoji_success = this.heart.assets.emoji.get('tick') || '✅';
            const container = new ContainerBuilder()
                .setAccentColor(0x2ECC71)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `## ${emoji_success} Identity Verified\n` +
                        `Your Discord account is now securely linked to \`${session.email}\`.\n\n` +
                        `Future purchases will automatically sync roles and delivery instructions to your DMs.`
                    )
                );

            await interaction.editReply({ components: [container] });

        } catch (error: any) {
            this.log.error('Database Upsert Failed:', error);
            await interaction.editReply({ content: '❌ An internal database error occurred while linking your account.', components: [] });
        }
    }

    private async sendOtpEmail(toEmail: string, code: string, discordUsername: string): Promise<void> {
        const host = this.heart.assets.secrets.get('SmtpHost');
        const port = parseInt(this.heart.assets.secrets.get('SmtpPort'));
        const user = this.heart.assets.secrets.get('SmtpUser');
        const pass = this.heart.assets.secrets.get('SmtpPass');

        if (!host || !user || !pass || isNaN(port)) {
            throw new Error("SMTP Credentials missing in environment variables (.env)");
        }

        const transporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass }
        });

        const htmlTemplate = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                /* Enterprise Mobile Responsive Engine */
                @media only screen and (max-width: 600px) {
                    .main-wrapper { padding: 20px 10px !important; }
                    .content-box { padding: 30px 20px !important; }
                    .otp-container { padding: 15px 10px !important; }
                    .otp-code { font-size: 32px !important; letter-spacing: 8px !important; margin-right: -8px !important; }
                    .footer-box { padding: 20px !important; }
                }
            </style>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f3f4f6; -webkit-font-smoothing: antialiased;">
            <div class="main-wrapper" style="background-color: #f3f4f6; padding: 40px 15px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <div style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);">
                    
                    <div style="height: 6px; background-color: #9B59B6; background: linear-gradient(90deg, #9B59B6, #3498DB);"></div>

                    <div class="content-box" style="padding: 40px;">
                        <div style="text-align: center; margin-bottom: 30px;">
                            <h2 style="color: #111827; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">${this.heart.assets.secrets.get("BotName") || " "} Email Link</h2>
                        </div>

                        <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-top: 0;">Hello <strong>${discordUsername}</strong>,</p>
                        <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-bottom: 30px;">
                            A request was initiated to link this email address to your Discord profile. To authorize this connection, please use the secure code below:
                        </p>
                        
                        <div style="text-align: center; margin: 30px 0;">
                            <div class="otp-container" style="display: inline-block; padding: 20px 30px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; width: 100%; max-width: 280px; box-sizing: border-box;">
                                <span class="otp-code" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 36px; font-weight: 700; letter-spacing: 10px; color: #9B59B6; display: block; margin-right: -10px; text-align: center;">${code}</span>
                            </div>
                        </div>
                        
                        <p style="color: #4b5563; font-size: 14px; line-height: 1.5; margin-bottom: 0;">
                            For your security, this code will expire in <strong>5 minutes</strong>. Do not share it with anyone.
                        </p>
                    </div>

                    <div class="footer-box" style="background-color: #f9fafb; padding: 24px 40px; border-top: 1px solid #f3f4f6; text-align: center;">
                        <p style="color: #6b7280; font-size: 12px; line-height: 1.5; margin: 0;">
                            If you did not initiate this request inside our Discord server, you can safely ignore and delete this email.
                        </p>
                    </div>
                </div>
                
                <div style="text-align: center; margin-top: 24px;">
                    <p style="color: #9ca3af; font-size: 12px; font-weight: 500; margin: 0;">Security Systems</p>
                </div>
            </div>
        </body>
        </html>
        `;

        await transporter.sendMail({
            to: toEmail,
            subject: `Verification Code: ${code}`,
            html: htmlTemplate
        });
    }

    private async handleSetInstruction(interaction: ChatInputCommandInteraction): Promise<void> {
        const config = this.heart.assets.config.get('sellauth') as unknown as SellAuthConfig;
        
        if (config.roles?.admin && !interaction.guild?.members.cache.get(interaction.user.id)?.roles.cache.has(config.roles.admin)) {
            await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} You do not possess the required SellAuth Admin role.`);
            return;
        }

        const productIdStr = interaction.options.getString('product', true);
        const rawInstruction = interaction.options.getString('instruction', true);
        const formattedInstruction = rawInstruction.replace(/\\n/g, '\n');
        const productName = this.productCache?.find(p => String(p.id) === productIdStr)?.name || `Product ID ${productIdStr}`;

        try {
            const pool = this.getDatabasePool();
            
            await pool.query(`
                INSERT INTO products (product_id, name, delivery_instructions, is_active)
                VALUES ($1, $2, $3, true)
                ON CONFLICT (product_id) 
                DO UPDATE SET delivery_instructions = $3, name = $2, is_active = true
            `, [productIdStr, productName, formattedInstruction]);

            const emoji_success = this.heart.assets.emoji.get('tick') || '✅';
            const emoji_product = this.heart.assets.emoji.get('box') || '📦';
            const emoji_paper = this.heart.assets.emoji.get('paper') || '📝';

            const container = new ContainerBuilder()
                .setAccentColor(0x2ECC71) 
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## ${emoji_success} Delivery Instructions Updated`)
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`**${emoji_product} Product:** \`${productName}\``),
                            new TextDisplayBuilder().setContent(`**${emoji_paper} Product ID:** \`${productIdStr}\``),
                            new TextDisplayBuilder().setContent(`### Current Instructions:\n${formattedInstruction}`)
                        )
                        .setButtonAccessory(
                            new ButtonBuilder()
                                .setStyle(ButtonStyle.Link)
                                .setLabel('View Product')
                                .setURL(`https://dash.sellauth.com/products/${productIdStr}`)
                        )
                );

            await interaction.editReply({ 
                components: [container],
                flags: MessageFlags.IsComponentsV2 
            });

        } catch (error: any) {
            this.log.error(`Failed to set instruction for product ${productIdStr}:`, error);
            const isDiscordError = error.message.includes('errors');
            await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} **${isDiscordError ? 'UI Validation Error' : 'Database Error'}:** \`${error.message}\``);
        }
    }
    private async handleGetInvoice(interaction: ChatInputCommandInteraction): Promise<void> {
        const config = this.heart.assets.config.get('sellauth') as unknown as SellAuthConfig;
        
        if (config.roles?.admin && !interaction.guild?.members.cache.get(interaction.user.id)?.roles.cache.has(config.roles.admin)) {
            await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} You do not possess the required SellAuth Admin role.`);
            return;
        }

        const queryId = interaction.options.getString('invoice_id', true).trim();

        try {
            const response = await fetch(`https://api.sellauth.com/v1/shops/${config.shopId}/invoices/${queryId}`, {
                headers: {
                    'Authorization': `Bearer ${config.sellauthApiKey}`,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                if (response.status === 404) {
                    await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} **Invoice Not Found.** Double-check the ID or UUID.`);
                    return;
                }
                throw new Error(`SellAuth API returned ${response.status}`);
            }

            const invoice = await response.json();
            
            const isSuccess = invoice.status.toLowerCase() === 'completed';
            const emoji = this.heart.assets.emoji.get('sellauth') || '🛒';
            const emoji_box = this.heart.assets.emoji.get('box') || '📦';
            const emoji_user = this.heart.assets.emoji.get('user') || '👤';

            const container = new ContainerBuilder()
                .setAccentColor(isSuccess ? 0x2ECC71 : 0xE74C3C)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `## ${emoji} Invoice Details\n` +
                        `**ID:** \`${invoice.id}\`\n` +
                        `**Status:** \`${invoice.status.toUpperCase()}\`\n` +
                        `**Total:** **${invoice.price} ${invoice.currency}**`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `### ${emoji_user} Customer & Payment\n` +
                        `**Email:** \`${invoice.email}\`\n` +
                        `**IP:** \`${invoice.ip || 'N/A'}\` (:flag_${invoice.country_code?.toLowerCase() || 'us'}:)\n` +
                        `**Method:** \`${invoice.payment_method?.name || invoice.gateway}\``
                    )
                );

            const productLines = (invoice.items || []).map((item: any) => {
                const variant = item.variant?.name ? ` \`(${item.variant.name})\`` : '';
                return `• **${item.product?.name || 'Product'}**${variant} x${item.quantity}`;
            }).join('\n');

            container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`### ${emoji_box} Items Ordered\n${productLines || 'None'}`)
                );

            const customFieldMap = new Map<string, string>();
            const sources = [
                invoice.custom_fields,
                invoice.metadata,
                ...(invoice.items?.map((i: any) => i.custom_fields) || [])
            ];

            sources.forEach(source => {
                if (!source || typeof source !== 'object') return;
                Object.entries(source).forEach(([key, val]) => {
                    if (val && typeof val !== 'object') {
                        customFieldMap.set(key, String(val));
                    }
                });
            });

            if (customFieldMap.size > 0) {
                const dataStr = Array.from(customFieldMap.entries())
                    .map(([k, v]) => `**${k.replace(/[-_]/g, ' ')}:** \`${v}\``)
                    .join('\n');

                container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`### 📝 Custom Data\n${dataStr}`)
                    );
            }

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel('Manage in SellAuth')
                    .setURL(`https://dash.sellauth.com/invoices/${invoice.id}?shopId=${config.shopId}`)
            );
            container.addActionRowComponents(row);

            await interaction.editReply({ 
                components: [container],
                flags: MessageFlags.IsComponentsV2 
            });

        } catch (error: any) {
            this.log.error(`Invoice Fetch Error for ${queryId}:`, error);
            await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} **Error fetching invoice:** \`${error.message}\``);
        }
    }

    @Cooldown('sellauth_profile', { limit: 1, windowMs: 15000 })
    private async handleProfile(interaction: ChatInputCommandInteraction): Promise<void> {
        const config = this.heart.assets.config.get('sellauth') as unknown as SellAuthConfig;
        const pool = this.getDatabasePool();

        try {
            const userRes = await pool.query('SELECT email, linked_at FROM sellauth_users WHERE discord_id = $1', [interaction.user.id]);
            
            if (userRes.rowCount === 0) {
                const emoji_cross = this.heart.assets.emoji.get('cross') || '❌';
                await interaction.editReply(`${emoji_cross} **No Account Linked:** You haven't linked an email yet.\nUse \`/sellauth link email:<your_email>\` to connect your account and view your profile.`);
                return;
            }

            const linkedEmail = userRes.rows[0].email;
            const linkedAt = new Date(userRes.rows[0].linked_at);
            const linkedTs = Math.floor(linkedAt.getTime() / 1000);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS sellauth_invoices (
                    invoice_id INTEGER PRIMARY KEY,
                    discord_id TEXT NOT NULL,
                    price_usd NUMERIC DEFAULT 0,
                    items_json JSONB,
                    completed_at TIMESTAMP
                );
            `);

            const cursorRes = await pool.query('SELECT MAX(invoice_id) as last_id, COUNT(*) as local_count FROM sellauth_invoices WHERE discord_id = $1', [interaction.user.id]);
            const lastInvoiceId = cursorRes.rows[0].last_id || 0;
            const localCount = parseInt(cursorRes.rows[0].local_count || '0', 10);

            const fetchLimit = localCount === 0 ? '100' : '10';

            const queryParams = new URLSearchParams({
                'email': linkedEmail,
                'statuses[0]': 'completed',
                'per_page': fetchLimit,
                'with': 'items',
                'orderColumn': 'completed_at',
                'orderDirection': 'desc'
            });

            const response = await fetch(`https://api.sellauth.com/v1/shops/${config.shopId}/invoices?${queryParams.toString()}`, {
                headers: {
                    'Authorization': `Bearer ${config.sellauthApiKey}`,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) throw new Error(`SellAuth API returned ${response.status}`);
            
            const json = await response.json();
            const fetchedInvoices = json.data || []; 

            for (const inv of fetchedInvoices) {
                if (inv.id <= lastInvoiceId) break;

                const price = parseFloat(inv.paid_usd || inv.price_usd || inv.price || '0');
                
                await pool.query(`
                    INSERT INTO sellauth_invoices (invoice_id, discord_id, price_usd, items_json, completed_at)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (invoice_id) DO NOTHING
                `, [
                    inv.id, 
                    interaction.user.id, 
                    isNaN(price) ? 0 : price, 
                    JSON.stringify(inv.items || []), 
                    inv.completed_at
                ]);
            }

            const statsRes = await pool.query(`
                SELECT COUNT(*) as total_orders, SUM(price_usd) as total_spent
                FROM sellauth_invoices 
                WHERE discord_id = $1
            `, [interaction.user.id]);

            const totalLifetimeOrders = parseInt(statsRes.rows[0].total_orders || '0', 10);
            const totalSpent = parseFloat(statsRes.rows[0].total_spent || '0');

            const recentRes = await pool.query(`
                SELECT items_json 
                FROM sellauth_invoices 
                WHERE discord_id = $1 
                ORDER BY completed_at DESC 
                LIMIT 5
            `, [interaction.user.id]);

            const recentItems: string[] = [];
            let itemsCount = 0;

            for (const row of recentRes.rows) {
                if (itemsCount >= 5) break;
                const items = row.items_json || [];
                
                for (const item of items) {
                    if (itemsCount < 5) {
                        const variant = item.variant?.name ? ` \`(${item.variant.name})\`` : '';
                        const deliveryStatus = item.delivered ? ' *(Delivered)*' : '';
                        recentItems.push(`• **${item.product?.name || 'Unknown Product'}**${variant}${deliveryStatus}`);
                        itemsCount++;
                    }
                }
            }

            const emoji_user = this.heart.assets.emoji.get('user') || '👤';
            const emoji_money = this.heart.assets.emoji.get('money') || '💵';
            const emoji_box = this.heart.assets.emoji.get('box') || '📦';
            
            let tier = "Standard Member";
            let accentColor = 0x3498DB;
            if (totalSpent >= 50) { tier = "Silver Member"; accentColor = 0x95A5A6; }
            if (totalSpent >= 150) { tier = "Gold VIP"; accentColor = 0xF1C40F; }
            if (totalSpent >= 500) { tier = "Diamond Elite"; accentColor = 0x9B59B6; }

            const container = new ContainerBuilder()
                .setAccentColor(accentColor)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## ${emoji_user} Your Customer Profile`)
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### Identity Details\n` +
                    `**Email:** \`${this.maskEmail(linkedEmail)}\`\n` +
                    `**Linked On:** <t:${linkedTs}:D>\n` +
                    `**Status:** \`${tier}\``
                ),
                new TextDisplayBuilder().setContent(
                    `### ${emoji_money} Lifetime Statistics\n` +
                    `**Total Spent:** \`$${totalSpent.toFixed(2)} USD\`\n` +
                    `**Completed Orders:** \`${totalLifetimeOrders}\``
                )
            );

            const recentText = recentItems.length > 0 ? recentItems.join('\n') : '*No recent purchases found.*';
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`### ${emoji_box} Recent Acquisitions\n${recentText}`)
                );

            await interaction.editReply({ 
                components: [container],
                flags: MessageFlags.IsComponentsV2 
            });

        } catch (error: any) {
            this.log.error(`Profile Fetch Error for ${interaction.user.id}:`, error);
            const isDiscordError = error.message.includes('errors');
            await interaction.editReply(`${this.heart.assets.emoji.get('cross') || '❌'} **${isDiscordError ? 'UI Validation Error' : 'Data Error'}:** \`${error.message}\``);
        }
    }

    private maskEmail(email: string): string {
        if (!email || typeof email !== 'string' || !email.includes('@')) {
            return '******@***.***';
        }
        
        const [local, domain] = email.split('@');
        
        const maskedLocal = local.length > 4 
            ? local.substring(0, 2) + '*'.repeat(local.length - 4) + local.slice(-2)
            : local.substring(0, 1) + '*'.repeat(Math.max(local.length - 1, 1));
            
        const domainParts = domain.split('.');
        const tld = domainParts.pop() || 'com';
        const provider = domainParts.join('.');
        
        const maskedProvider = provider.length > 2
            ? provider.substring(0, 1) + '*'.repeat(provider.length - 2) + provider.slice(-1)
            : provider.substring(0, 1) + '*'.repeat(Math.max(provider.length - 1, 1));

        return `${maskedLocal}@${maskedProvider}.${tld}`;
    }

    private getDatabasePool() {
        try { return this.heart.db.postgres.get('sellauth'); } 
        catch { return this.heart.db.postgres.get('main'); }
    }
}