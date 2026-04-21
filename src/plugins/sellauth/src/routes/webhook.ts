import express, { type Request, type Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { 
    type TextChannel, 
    DiscordAPIError, 
    type Guild, 
    type GuildMember,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    MessageFlags
} from 'discord.js';
import { BaseRoute } from '../../../../core/bases/Route.js';
import { type IHeart } from '../../../../core/heart/index.js';
import { type SellAuthConfig } from '../../index.js';

const SellAuthWebhookSchema = z.object({
    event: z.string(),
    shop_id: z.number(),
    data: z.object({
        invoice_id: z.number()
    })
});

export type SellAuthWebhookPayload = z.infer<typeof SellAuthWebhookSchema>;

export interface SellAuthInvoice {
    id: number;
    status: string;
    price: string;
    currency: string;
    gateway: string;
    email: string;
    custom_fields: Record<string, any> | null;
    payment_method?: { name: string };
    customer?: { discord_id?: string | null; discord_username?: string | null };
    items: Array<{
        product_id: number;
        quantity: number;
        product?: { name: string };
        variant?: { name: string };
    }>;
}

export default class SellAuthWebhookRoute extends BaseRoute {
    public readonly basePath = '/webhook';
    
    private readonly MAX_RETRIES = 3; 
    
    private idempotencyCache: any; 

    constructor(heart: IHeart) {
        super(heart);
        
        this.idempotencyCache = new this.heart.toolbox.data.Cache({
            defaultTTL: 86400000,
            maxSize: 5000
        });

        this.register();
    }

    protected register(): void {
        const rawBodyParser = express.json({
            verify: (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => {
                req.rawBody = buf;
            }
        });

        this.router.post('', rawBodyParser, this.asyncHandler(this.handleWebhook.bind(this)));
    }

    private async handleWebhook(req: Request & { rawBody?: Buffer }, res: Response) {
        const rawConfig = this.heart.assets.config.get('sellauth');
        const config = rawConfig as unknown as SellAuthConfig | undefined;
        
        if (!config || !config.enabled) {
            return res.status(503).json({ error: 'Service Unavailable', message: 'SellAuth integration is disabled.' });
        }

        if (!this.verifySignature(req, config.webhookSecret)) {
            this.log.warn(`[Security] Invalid HMAC signature from IP: ${req.ip}`);
            return res.status(401).json({ error: 'Unauthorized', message: 'Invalid Signature' });
        }

        const parsedBody = SellAuthWebhookSchema.safeParse(req.body);
        if (!parsedBody.success) {
            this.log.error(`[Validation] Malformed webhook from SellAuth`, parsedBody.error.issues);
            return res.status(400).json({ error: 'Bad Request', details: parsedBody.error.issues });
        }

        const payload = parsedBody.data;
        const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

        if (idempotencyKey) {
            const isDuplicate = this.checkIdempotency(idempotencyKey, String(payload.data.invoice_id));
            if (isDuplicate) {
                return res.status(200).json({ success: true, message: 'Event already processed' });
            }
        }

        res.status(200).json({ success: true, message: 'Accepted for processing' });

        this.processEventPipeline(payload, config).catch(err => {
            this.log.error(`[Invoice:${payload.data.invoice_id}] [Pipeline Error] Unhandled exception:`, err);
        });
    }

    private async processEventPipeline(payload: SellAuthWebhookPayload, config: SellAuthConfig): Promise<void> {
        const invoiceId = String(payload.data.invoice_id);
        const shopId = String(payload.shop_id);
        
        this.log.info(`[Invoice:${invoiceId}] Starting API fetch and pipeline for event: ${payload.event}`);

        try {
            if (!config.guild) throw new Error('Critical Configuration Error: guild is missing in sellauth config.');
            if (!config.sellauthApiKey) throw new Error('Critical Configuration Error: sellauthApiKey is missing.');

            const guild = await this.heart.client.guilds.fetch(config.guild).catch(() => null);
            if (!guild) throw new Error(`Critical Discord Error: Cannot fetch Guild with ID ${config.guild}`);

            const invoice = await this.fetchInvoiceFromAPI(shopId, invoiceId, config.sellauthApiKey);

            switch (invoice.status.toLowerCase()) {
                case 'completed':
                    await this.handleFulfillment(invoice, config, guild);
                    break;
                case 'refunded':
                case 'cancelled':
                case 'disputed':
                    await this.handleRevocation(invoice, config, guild);
                    break;
                default:
                    this.log.info(`[Invoice:${invoiceId}] Ignored invoice with status: ${invoice.status}`);
            }

            await this.sendNotificationSummary(payload.event, invoice, config);

            this.log.info(`[Invoice:${invoiceId}] Pipeline completed successfully.`);
        } catch (error) {
            this.log.error(`[Invoice:${invoiceId}] Pipeline failed completely:`, error);
        }
    }

    private async fetchInvoiceFromAPI(shopId: string, invoiceId: string, apiKey: string): Promise<SellAuthInvoice> {
        const response = await fetch(`https://api.sellauth.com/v1/shops/${shopId}/invoices/${invoiceId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`SellAuth API Error [${response.status}]: ${errText}`);
        }

        return await response.json() as SellAuthInvoice;
    }

    private extractDiscordId(invoice: any): string | null {
        if (invoice.customer?.discord_id) return String(invoice.customer.discord_id);
        
        if (invoice.custom_fields) {
            const id = invoice.custom_fields['discord_id'] || invoice.custom_fields['Discord User ID'];
            if (id) return String(id);
        }

        for (const item of invoice.items || []) {
            if (item.custom_fields) {
                const id = item.custom_fields['discord_id'] || item.custom_fields['Discord User ID'];
                if (id) return String(id);
            }
        }
        
        return null;
    }

    private async handleFulfillment(invoice: SellAuthInvoice, config: SellAuthConfig, guild: Guild): Promise<void> {
        const discordId = this.extractDiscordId(invoice);
        
        if (!discordId) {
            this.log.info(`[Invoice:${invoice.id}] No discord_id attached to order. Skipping Discord fulfillment.`);
            return;
        }

        try {
            const member = await guild.members.fetch(discordId);
            
            if (config.roles?.customer && !member.roles.cache.has(config.roles.customer)) {
                await this.withRetry(
                    () => member.roles.add(config.roles!.customer!, `SellAuth Purchase: ${invoice.id}`),
                    `Role Assignment (${member.user.tag})`,
                    String(invoice.id)
                );
            }

            if (config.features?.autoDMInstructions && invoice.items && invoice.items.length > 0) {
                await this.deliverProductInstructions(member, invoice);
            }

        } catch (error: any) {
            if (error instanceof DiscordAPIError && error.code === 10007) {
                this.log.warn(`[Invoice:${invoice.id}] Member ${discordId} is no longer in the server.`);
            } else {
                this.log.error(`[Invoice:${invoice.id}] Fulfillment crashed for ${discordId}:`, error);
            }
        }
    }

    private async deliverProductInstructions(member: GuildMember, invoice: SellAuthInvoice): Promise<void> {
        const invoiceId = String(invoice.id);
        try {
            const pool = this.getDatabasePool();
            let deliveryMessage = `**Order Complete!** 🎉\nThank you for your purchase. Here is your product information:\n\n`;
            let hasInstructions = false;

            for (const item of invoice.items) {
                const result = await pool.query(
                    'SELECT delivery_instructions FROM products WHERE product_id = $1 AND is_active = true LIMIT 1',
                    [String(item.product_id)]
                );

                if (result.rowCount && result.rowCount > 0) {
                    const instructions = result.rows[0].delivery_instructions;
                    const productName = item.product?.name || `Product ID ${item.product_id}`;
                    deliveryMessage += `__**${productName}**__\n${instructions}\n\n`;
                    hasInstructions = true;
                }
            }

            if (!hasInstructions) {
                this.log.warn(`[Invoice:${invoiceId}] No active instructions found in DB for any products in this order.`);
                return;
            }

            await this.withRetry(
                () => member.send({ content: deliveryMessage.trim() }),
                `DM Delivery (${member.user.tag})`,
                invoiceId
            );

        } catch (error: any) {
            if (error instanceof DiscordAPIError && error.code === 50007) {
                this.log.warn(`[Invoice:${invoiceId}] Cannot deliver instructions. ${member.user.tag} has DMs closed.`);
            } else {
                this.log.error(`[Invoice:${invoiceId}] Instruction delivery failed:`, error);
            }
        }
    }

    private async handleRevocation(invoice: SellAuthInvoice, config: SellAuthConfig, guild: Guild): Promise<void> {
        const discordId = this.extractDiscordId(invoice);
        if (!discordId || !config.roles?.customer) return;
        
        try {
            const member = await guild.members.fetch(discordId);
            if (member && member.roles.cache.has(config.roles.customer)) {
                await this.withRetry(
                    () => member.roles.remove(config.roles!.customer!, `SellAuth Revocation: ${invoice.id}`),
                    `Role Revocation (${member.user.tag})`,
                    String(invoice.id)
                );
            }
        } catch (error: any) {
            if (error.code !== 10007) this.log.error(`[Invoice:${invoice.id}] Failed to revoke roles:`, error);
        }
    }

    private async sendNotificationSummary(eventAction: string, invoice: any, config: any): Promise<void> {
        if (!config.notificationChannel) return;

        try {
            const channel = await this.heart.client.channels.fetch(config.notificationChannel);
            if (!channel || !channel.isTextBased()) return;

            const isSuccess = invoice.status.toLowerCase() === 'completed';
            const emoji = this.heart.assets.emoji.get('sellauth') || '🛒';
            const system_emoji = this.heart.assets.emoji.get('system') || this.heart.assets.emoji.get('audit') || this.heart.assets.emoji.get('gear') || '🖥️';
            const shopping_emoji = this.heart.assets.emoji.get('shopping_cart') || this.heart.assets.emoji.get('cart') || this.heart.assets.emoji.get('shopping') || '🛒';
            const crypto_emoji = this.heart.assets.emoji.get('crypto') || this.heart.assets.emoji.get('blockchain') || '⛓';

            const createdAt = new Date(invoice.created_at);
            const createdTs = Math.floor(createdAt.getTime() / 1000);

            const container = new ContainerBuilder()
                .setAccentColor(isSuccess ? 0x2ECC71 : 0xF1C40F)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `## ${emoji} SellAuth Log: ${eventAction}\n` +
                        `**Status:** \`${invoice.status.toUpperCase()}\`\n` +
                        `**ASN:** \`${invoice.asn || 'N/A'}\`\n` +
                        `**Created:** <t:${createdTs}:f>`
                    )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder()
                        .setDivider(true)
                        .setSpacing(SeparatorSpacingSize.Small)
                );

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### Order Identity\n` +
                    `ID: \`${invoice.id}\`\n` +
                    `UID: \`${invoice.unique_id}\``
                )
            );

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### Financials\n` +
                    `Total: **${invoice.price} ${invoice.currency}**\n` +
                    `USD Value: \`$${invoice.price_usd}\``
                )
            );

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### Gateway\n` +
                    `Method: \`${invoice.payment_method?.name || invoice.gateway}\`\n` +
                    `Status: \`${invoice.status.toUpperCase()}\``
                )
            );

            container.addSeparatorComponents(
                new SeparatorBuilder()
                    .setDivider(false)
                    .setSpacing(SeparatorSpacingSize.Large)
            );

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### Customer Info\n` +
                    `Email: \`${invoice.email}\`\n` +
                    `Country: :flag_${invoice.country_code?.toLowerCase() || 'us'}: ` +
                    `\`${invoice.country_code || 'US'}\``
                )
            );

            if (invoice.crypto_address || invoice.crypto_amount) {
                const txId = invoice.payments?.[0]?.crypto_transaction_id;
                const explorerLink = txId
                    ? `\n[View on Chain](https://blockchair.com/search?q=${txId})`
                    : '';

                container.addSeparatorComponents(
                    new SeparatorBuilder()
                        .setDivider(false)
                        .setSpacing(SeparatorSpacingSize.Small)
                );

                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `### ${crypto_emoji} Crypto Transaction\n` +
                        `Amount: \`${invoice.crypto_amount} ${invoice.gateway}\`\n` +
                        `Address: \`${invoice.crypto_address}\`${explorerLink}`
                    )
                );
            }

            const productLines = (invoice.items || [])
                .map((item: any) => {
                    const variant = item.variant?.name ? ` \`(${item.variant.name})\`` : '';
                    return `• **${item.product?.name || 'Product'}**${variant} x${item.quantity} ` +
                        `(\`${item.total_price} ${invoice.currency}\`)`;
                })
                .join('\n');

            container.addSeparatorComponents(
                new SeparatorBuilder()
                    .setDivider(false)
                    .setSpacing(SeparatorSpacingSize.Small)
            );

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### ${shopping_emoji} Products Ordered\n` +
                    (productLines || 'No items found.')
                )
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
                const custom_emoji = this.heart.assets.emoji.get('paper') || this.heart.assets.emoji.get('data') || '📝';
                const dataStr = Array.from(customFieldMap.entries())
                    .map(([k, v]) => `**${this.formatFieldName(k)}:** \`${v}\``)
                    .join('\n');

                container.addSeparatorComponents(
                    new SeparatorBuilder()
                        .setDivider(false)
                        .setSpacing(SeparatorSpacingSize.Small)
                );

                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `### ${custom_emoji} Custom & Metadata\n${dataStr}`
                    )
                );
            }

            container.addSeparatorComponents(
                new SeparatorBuilder()
                    .setDivider(true)
                    .setSpacing(SeparatorSpacingSize.Small)
            );

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### ${system_emoji} System Audit\n` +
                    `**IP:** \`${invoice.ip}\`\n` +
                    `**User Agent:** \`${String(invoice.user_agent || '')
                        .substring(0, 100)}...\``
                )
            );

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel('View Invoice Online')
                    .setURL(`https://dash.sellauth.com/invoices/${invoice.id}?shopId=${config.shopId}`)
            );

            container.addActionRowComponents(row);

            await (channel as TextChannel).send({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

        } catch (error) {
            this.log.error(`[Invoice:${invoice.id}] Audit notification failed:`, error);
        }
    }
    private verifySignature(req: Request & { rawBody?: Buffer }, secret: string): boolean {
        const signature = req.headers['x-sellauth-signature'] || req.headers['x-signature'];
        if (!signature || typeof signature !== 'string' || !req.rawBody) return false;
        try {
            const expectedSignature = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
            const signatureBuffer = Buffer.from(signature);
            const expectedBuffer = Buffer.from(expectedSignature);
            if (signatureBuffer.length !== expectedBuffer.length) return false;
            return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
        } catch { return false; }
    }

    private checkIdempotency(key: string, invoiceId: string): boolean {
        if (this.idempotencyCache.has(key)) {
            this.log.debug(`[Invoice:${invoiceId}] Dropped duplicate event ID: ${key}`);
            return true;
        }
        
        this.idempotencyCache.set(key, true);
        return false;
    }

    private formatFieldName(key: string): string {
        return key.replace(/[-_]/g, ' ').trim().split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
    }

    private getDatabasePool() {
        try { return this.heart.db.postgres.get('sellauth'); } 
        catch { return this.heart.db.postgres.get('main'); }
    }

    private async withRetry<T>(operation: () => Promise<T>, taskName: string, idStr: string, retries = this.MAX_RETRIES): Promise<T> {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try { return await operation(); } 
            catch (error: any) {
                if (error instanceof DiscordAPIError && [50007, 10007, 50013].includes(error.code as number)) throw error; 
                if (attempt === retries) throw error;
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw new Error('Unreachable');
    }
}