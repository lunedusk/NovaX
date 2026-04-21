import { 
    TextDisplayBuilder, 
    SeparatorBuilder, 
    SeparatorSpacingSize, 
    ContainerBuilder,
    MessageFlags,
    type Interaction,
    type Message,
    type CacheType
} from 'discord.js';
import { cooldownManager } from '#core/manager/cooldown.js';
import { getLogger } from '#core/utils/logger.js';
import { emojis } from '#core/manager/emoji.js';

const log = getLogger('CooldownDecorator');

export interface CooldownOptions {
    userIndex?: number; 
    onLimit?: (remainingMs: number) => unknown;
    limit?: number;
    windowMs?: number;
}

type RepliableContext = Message | Interaction<CacheType>;

export function Cooldown(slug: string, options: CooldownOptions = {}) {
    return function <T extends (...args: any[]) => any>(
        originalMethod: T,
        context: ClassMethodDecoratorContext
    ) {
        const propertyKey = String(context.name);

        async function replacementMethod(this: any, ...args: Parameters<T>) {
            const userIdx = options.userIndex ?? 0;
            const ctx = args[userIdx] as RepliableContext;
            
            const userId = ('user' in ctx ? ctx.user.id : ('author' in ctx ? ctx.author.id : null));
            const guildId = ctx?.guildId ?? undefined;
            const commandId = `${slug}:${propertyKey}`;

            if (!userId) {
                log.warn(`Cooldown decorator on '${propertyKey}' could not resolve a User ID.`);
                return originalMethod.apply(this, args);
            }

            const result = await cooldownManager.isRateLimited(
                slug, 
                { userId, guildId, commandId },
                options.limit,
                options.windowMs
            );

            if (result.limited) {
                const remainingSec = (result.remaining / 1000).toFixed(1);

                if (options.onLimit) {
                    return options.onLimit(result.remaining);
                }

                if (ctx && 'isRepliable' in ctx && typeof ctx.isRepliable === 'function' && ctx.isRepliable()) {
                    const cooldownUI = new ContainerBuilder()
                        .setAccentColor(0xFF4444)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`**${emojis.get('clock') || '⏳'} Rate Limit Exceeded**`),
                        )
                        .addSeparatorComponents(
                            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true),
                        )
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `${emojis.get('cross') || '❌'} Please wait **${remainingSec}s** before using \`${propertyKey}\` again.`
                            ),
                        );

                    const payload = {
                        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
                        components: [cooldownUI]
                    };

                    try {
                        if ('deferred' in ctx && 'replied' in ctx && (ctx.deferred || ctx.replied)) {
                            return await (ctx as any).followUp(payload);
                        } else {
                            return await (ctx as any).reply(payload);
                        }
                    } catch (replyErr) {
                        log.error(`Failed to send cooldown warning: ${(replyErr as Error).message}`);
                        return;
                    }
                }

                throw new Error(`Rate limit exceeded for ${slug}. Retry in ${remainingSec}s.`);
            }

            return originalMethod.apply(this, args);
        }

        return replacementMethod;
    };
}