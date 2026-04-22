import {
  type Interaction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  LabelBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ButtonBuilder
} from 'discord.js';
import { BaseEvent } from '../../../../core/bases/Event.js';
import { type SellAuthConfig } from '../../index.js';
import { getLogger } from '../../../../core/utils/logger.js';

const log = getLogger('ReviewEvent');

export default class SellAuthReviewEvent extends BaseEvent<[Interaction]> {
  public readonly name = 'system.ready';

  public buttons = new Map([
    [/^sa_rev_btn_\d+$/, async (i: any) => this.handleReviewButton(i)],
  ]);

  public modals = new Map([
    [/^sa_rev_mod_\d+$/, async (i: any) => this.handleReviewModal(i)],
  ]);

  public async execute(): Promise<void> {}

  private getDatabasePool() {
    try {
      return this.heart.db.postgres.get('sellauth');
    } catch {
      return this.heart.db.postgres.get('main');
    }
  }

  private async handleReviewButton(interaction: ButtonInteraction): Promise<void> {
    try {
      const invoiceId = interaction.customId.replace('sa_rev_btn_', '');
      const modalId = `sa_rev_mod_${invoiceId}`;

      const ratingSelect = new StringSelectMenuBuilder()
        .setCustomId('review_rating')
        .setPlaceholder('Select your rating (1–5 Stars)')
        .setRequired(true)
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('⭐⭐⭐⭐⭐ (5 Stars) - Excellent')
            .setDescription('Top tier experience')
            .setValue('5'),
          new StringSelectMenuOptionBuilder()
            .setLabel('⭐⭐⭐⭐ (4 Stars) - Good')
            .setDescription('Very good overall')
            .setValue('4'),
          new StringSelectMenuOptionBuilder()
            .setLabel('⭐⭐⭐ (3 Stars) - Average')
            .setDescription('Nothing special, nothing terrible')
            .setValue('3'),
          new StringSelectMenuOptionBuilder()
            .setLabel('⭐⭐ (2 Stars) - Poor')
            .setDescription('Below expectations')
            .setValue('2'),
          new StringSelectMenuOptionBuilder()
            .setLabel('⭐ (1 Star) - Terrible')
            .setDescription('Very bad experience')
            .setValue('1'),
        );

      const ratingLabel = new LabelBuilder()
        .setLabel('How would you rate your experience?')
        .setDescription('Select a rating from 1 to 5 stars')
        .setStringSelectMenuComponent(ratingSelect);

      const feedbackInput = new TextInputBuilder()
        .setCustomId('review_feedback')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Tell us about your experience!')
        .setMinLength(5)
        .setMaxLength(1000)
        .setRequired(true);

      const feedbackLabel = new LabelBuilder()
        .setLabel('Your Feedback')
        .setDescription('Give us some details so we can improve')
        .setTextInputComponent(feedbackInput);

      const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Leave a Review')
        .addLabelComponents(ratingLabel, feedbackLabel);

      await interaction.showModal(modal);
    } catch (error: any) {
      log.error('Discord API rejected the Modal payload:', error);
    }
  }

  private async handleReviewModal(interaction: ModalSubmitInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const invoiceId = interaction.customId.replace('sa_rev_mod_', '');

    let rawRatingStr = '5';
    try {
      const ratingValues = interaction.fields.getStringSelectValues('review_rating');
      if (ratingValues && ratingValues.length > 0) {
        rawRatingStr = ratingValues[0];
      }
    } catch (e) {
      log.warn('Failed to extract select menu value natively, defaulting to 5.');
    }

    const rawRating = parseInt(rawRatingStr, 10) || 5;
    const feedback = interaction.fields.getTextInputValue('review_feedback');

    const emoji_cross = this.heart.assets.emoji.get('cross') || '❌';
    const emoji_tick = this.heart.assets.emoji.get('tick') || '✅';
    const emoji_star = this.heart.assets.emoji.get('star') || '⭐';
    
    const emoji_paper = this.heart.assets.emoji.get('paper') || '📝';
    const emoji_user = this.heart.assets.emoji.get('user') || '👤';
    const emoji_cart = this.heart.assets.emoji.get('cart') || '🛒';
    const emoji_box = this.heart.assets.emoji.get('box') || '📦';
    const emoji_money = this.heart.assets.emoji.get('money') || '💵';
    const emoji_mail = this.heart.assets.emoji.get('mail') || '📧';

    const config = this.heart.assets.config.get('sellauth') as unknown as SellAuthConfig;
    if (!config.reviewChannel) {
      await interaction.editReply(`${emoji_cross} Review channel is not configured.`);
      return;
    }

    try {
      const response = await fetch(
        `https://api.sellauth.com/v1/shops/${config.shopId}/invoices/${invoiceId}`,
        {
          headers: {
            Authorization: `Bearer ${config.sellauthApiKey}`,
            Accept: 'application/json',
          },
        },
      );
      if (!response.ok) throw new Error('Could not verify invoice details.');
      const invoice = await response.json();

      const pool = this.getDatabasePool();
      let isAnonymous = true;
      try {
        const userRes = await pool.query(
          'SELECT is_anonymous FROM sellauth_users WHERE discord_id = $1',
          [interaction.user.id],
        );
        if (userRes.rowCount !== null && userRes.rowCount > 0) {
          isAnonymous = userRes.rows[0].is_anonymous;
        }
      } catch (e) {
        log.warn('Could not fetch privacy status, defaulting to public.');
      }

      const starString = emoji_star.repeat(rawRating) + '☆'.repeat(5 - rawRating);
      const buyerIdentity = isAnonymous ? '*(Anonymous Buyer)*' : `<@${interaction.user.id}>`;
      const purchaseTs = Math.floor(new Date(invoice.completed_at).getTime() / 1000);
      const orderValue = invoice.price && invoice.currency ? `${invoice.price} ${invoice.currency}` : 'N/A';
      
      const purchasedItems = (invoice.items || [])
        .map((i: any) => `• ${i.product?.name || 'Unknown Product'}`)
        .join('\n');

      const formattedFeedback = feedback.split('\n').map(line => `> ${line}`).join('\n');

      const maskEmailPublic = (email: string) => {
        if (!email || !email.includes('@')) return '******@***.***';
        const [local] = email.split('@');
        const mLocal =
          local.length > 3
            ? local.substring(0, 2) + '*'.repeat(local.length - 2)
            : local.substring(0, 1) + '**';
        return `${mLocal}@***.***`;
      };

      const reviewUI = new ContainerBuilder()
        .setAccentColor(rawRating >= 4 ? 0x2ecc71 : rawRating === 3 ? 0xf1c40f : 0xe74c3c)
        
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${emoji_paper} Verified Customer Review`),
        )
        .addSeparatorComponents(
          new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        )
        
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`### ${starString} \`(${rawRating}/5)\``),
          new TextDisplayBuilder().setContent(`${formattedFeedback}`)
        )
        .addSeparatorComponents(
          new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Large),
        )
        
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### Transaction Details\n` +
            `**${emoji_user} Buyer:** ${buyerIdentity}\n` +
            `**${emoji_mail} Account:** \`${maskEmailPublic(invoice.email)}\`\n` +
            `**${emoji_cart} Order:** \`#${invoice.id}\` (<t:${purchaseTs}:R>)\n` +
            `**${emoji_money} Value:** \`${orderValue}\``
          )
        )
        .addSeparatorComponents(
          new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
        )

        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### ${emoji_box} Acquired Products\n${purchasedItems || '*No specific items listed.*'}`
            )
        );

      const reviewChannel = await this.heart.client.channels.fetch(config.reviewChannel);
      if (!reviewChannel || !reviewChannel.isTextBased()) {
        throw new Error('Configured review channel is invalid.');
      }

      await (reviewChannel as any).send({
        components: [reviewUI],
        flags: MessageFlags.IsComponentsV2,
      });
      if (interaction.message) {
        try {
          const emoji_tada = this.heart.assets.emoji.get('tada') || '🎉';
          const emoji_tick = this.heart.assets.emoji.get('tick') || '✅';

          const v2Container = new ContainerBuilder()
            .setAccentColor(0x2ECC71) 
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## ${emoji_tada} Order Complete!\n` +
                    `Thank you for your purchase. We greatly appreciate your business!\n\n` +
                    `If you have a moment, please consider leaving a review for your order (\`${invoiceId}\`).`
                )
            );

          const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId('rev_completed')
              .setLabel('Review Submitted')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji(emoji_tick)
              .setDisabled(true)
          );

          v2Container.addActionRowComponents(disabledRow);

          await interaction.message.edit({
            components: [v2Container],
            flags: MessageFlags.IsComponentsV2
          });
          
          log.info(`[ReviewEvent] Disabled review button while preserving UI for: ${invoiceId}`);
        } catch (editError: any) {
          log.warn(`Could not update DM UI: ${editError.message}`);
        }
      }

      await interaction.editReply(
        `${emoji_tick} **Success:** Your review has been published. Thank you!`,
      );
    } catch (error: any) {
      log.error('Processing error:', error);
      await interaction.editReply(
        `${emoji_cross} **Error processing review:** ${error.message}`,
      );
    }
  }
}
