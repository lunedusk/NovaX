import { BaseMiddleware, type MiddlewareContext, type MiddlewareResult } from '#core/bases/Middleware.js';
import { guildGate } from '#core/manager/guildGate.js';

export default class GuildGateMiddleware extends BaseMiddleware {
    public readonly name = 'guildGate';
    public readonly order = 10;
    public readonly phases = ['command'] as const;

    public async run(ctx: MiddlewareContext): Promise<MiddlewareResult> {
        const i = ctx.commandInteraction ?? (ctx.interaction?.isChatInputCommand() ? ctx.interaction : null);
        if (!i || !i.guildId) return 'next';
        if (!guildGate.isReady()) return 'next';
        if (guildGate.isGuildBlocked(i.guildId)) {
            return 'stop';
        }
        return 'next';
    }
}
