import {
    CommandInteraction,
    MessageComponentInteraction,
    ModalSubmitInteraction,
    AutocompleteInteraction,
    NewsChannel as AnnouncementChannel,
    TextChannel,
    VoiceChannel,
    StageChannel,
    DMChannel,
    ThreadChannel,
    GuildForumThreadManager,
    GuildTextThreadManager,
    User,
    GuildMember,
    Webhook,
    WebhookClient,
    InteractionWebhook,
    Message,
    ClientUser,
} from 'discord.js';
import { resolveGlobalPlaceholders } from '#core/builders/helpers/string.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('DiscordMiddleware');

function applyMiddleware(options: any): any {
    if (!options) return options;

    if (typeof options === 'string') {
        return resolveGlobalPlaceholders(options);
    }

    if (options?.constructor?.name === 'MessagePayload') {
        return options;
    }

    if (Array.isArray(options)) {
        return options.map((opt) => {
            if (opt && typeof opt === 'object' && opt.name != null) {
                opt.name = resolveGlobalPlaceholders(String(opt.name));
                if (typeof opt.value === 'string') {
                    opt.value = resolveGlobalPlaceholders(opt.value);
                }
            }
            return opt;
        });
    }

    if (typeof options.content === 'string') {
        options.content = resolveGlobalPlaceholders(options.content);
    }

    if (Array.isArray(options.embeds)) {
        options.embeds = options.embeds.map((embed: any) => {
            const t = embed?.data ?? embed;
            if (t.title)             t.title             = resolveGlobalPlaceholders(t.title);
            if (t.description)       t.description       = resolveGlobalPlaceholders(t.description);
            if (t.url)               t.url               = resolveGlobalPlaceholders(t.url);
            if (t.author?.name)      t.author.name       = resolveGlobalPlaceholders(t.author.name);
            if (t.footer?.text)      t.footer.text       = resolveGlobalPlaceholders(t.footer.text);
            if (Array.isArray(t.fields)) {
                for (const field of t.fields) {
                    if (field.name)  field.name  = resolveGlobalPlaceholders(field.name);
                    if (field.value) field.value = resolveGlobalPlaceholders(field.value);
                }
            }
            return embed;
        });
    }

    if (Array.isArray(options.components)) {
        options.components = options.components.map((row: any) => {
            const targetRow = row?.data ?? row;
            if (Array.isArray(targetRow?.components)) {
                for (const comp of targetRow.components) {
                    const c = comp?.data ?? comp;
                    if (c.label)                         c.label       = resolveGlobalPlaceholders(c.label);
                    if (c.placeholder)                   c.placeholder = resolveGlobalPlaceholders(c.placeholder);
                    if (typeof c.value === 'string')     c.value       = resolveGlobalPlaceholders(c.value); // TextInput
                    if (Array.isArray(c.options)) {
                        for (const opt of c.options) {
                            if (opt.label)       opt.label       = resolveGlobalPlaceholders(opt.label);
                            if (opt.description) opt.description = resolveGlobalPlaceholders(opt.description);
                        }
                    }
                }
            }
            return row;
        });
    }

    if (options.data?.title != null) {
        options.data.title = resolveGlobalPlaceholders(options.data.title);
        if (Array.isArray(options.data.components)) {
            options.data.components = applyMiddleware(options.data.components);
        }
    } else if (options.title != null && options.components != null) {
        options.title = resolveGlobalPlaceholders(options.title);
        options.components = applyMiddleware(options.components);
    }
    if (Array.isArray(options.activities)) {
        for (const act of options.activities) {
            if (act.name)    act.name    = resolveGlobalPlaceholders(act.name);
            if (act.state)   act.state   = resolveGlobalPlaceholders(act.state);
            if (act.details) act.details = resolveGlobalPlaceholders(act.details);
        }
    }

    if (typeof options.name === 'string') {
        options.name = resolveGlobalPlaceholders(options.name);
    }
    if (options.message && typeof options.message === 'object') {
        options.message = applyMiddleware(options.message);
    }

    return options;
}

function patchMethod(proto: any, method: string): void {
    const original = proto[method];
    if (typeof original !== 'function') return;

    proto[method] = function (this: any, ...args: any[]) {
        if (args[0] !== undefined) args[0] = applyMiddleware(args[0]);
        return (original as Function).apply(this, args);
    };
}

export class DiscordMiddleware {
    public static apply(): void {
        log.info('Mounting Global Placeholder Middleware to all Discord.js surfaces...');

        const repliable = [CommandInteraction, MessageComponentInteraction, ModalSubmitInteraction] as const;
        for (const cls of repliable) {
            patchMethod(cls.prototype, 'reply');
            patchMethod(cls.prototype, 'editReply');
            patchMethod(cls.prototype, 'followUp');
            patchMethod(cls.prototype, 'deferReply');
        }

        const modalable = [CommandInteraction, MessageComponentInteraction] as const;
        for (const cls of modalable) {
            patchMethod(cls.prototype, 'showModal');
        }

        patchMethod(MessageComponentInteraction.prototype, 'update');
        patchMethod(MessageComponentInteraction.prototype, 'deferUpdate');

        patchMethod(AutocompleteInteraction.prototype, 'respond');
        const sendableChannels = [
            TextChannel,
            AnnouncementChannel,
            VoiceChannel,
            StageChannel,
            DMChannel,
            ThreadChannel,
        ] as const;

        for (const cls of sendableChannels) {
            patchMethod(cls.prototype, 'send');
        }
        patchMethod(GuildForumThreadManager.prototype, 'create');
        patchMethod(GuildTextThreadManager.prototype, 'create');
        patchMethod(User.prototype, 'send');
        patchMethod(GuildMember.prototype, 'send');
        patchMethod(Webhook.prototype, 'send');
        patchMethod(Webhook.prototype, 'editMessage');
        patchMethod(WebhookClient.prototype, 'send');
        patchMethod(WebhookClient.prototype, 'editMessage');
        patchMethod(InteractionWebhook.prototype, 'send');
        patchMethod(InteractionWebhook.prototype, 'editMessage');
        patchMethod(Message.prototype, 'reply');
        patchMethod(Message.prototype, 'edit');
        patchMethod(ClientUser.prototype, 'setPresence');
        const originalSetActivity = ClientUser.prototype.setActivity;
        if (typeof originalSetActivity === 'function') {
            (ClientUser.prototype as any).setActivity = function (this: any, ...args: any[]) {
                if (typeof args[0] === 'string') {
                    args[0] = resolveGlobalPlaceholders(args[0]);
                } else if (args[0] && typeof args[0] === 'object') {
                    if (args[0].name)    args[0].name    = resolveGlobalPlaceholders(args[0].name);
                    if (args[0].state)   args[0].state   = resolveGlobalPlaceholders(args[0].state);
                    if (args[0].details) args[0].details = resolveGlobalPlaceholders(args[0].details);
                }
                return (originalSetActivity as Function).apply(this, args);
            };
        }

        log.debug('Middleware successfully bound to all Discord.js prototypes.');
    }
}