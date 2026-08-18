import type { 
    ChatInputCommandInteraction, 
    ButtonInteraction, 
    AnySelectMenuInteraction, 
    ModalSubmitInteraction, 
    AutocompleteInteraction, 
    ContextMenuCommandInteraction
} from 'discord.js';
import { getLogger } from '#core/utils/logger.js';
import type { RouteAccessConfig } from '#core/manager/permissions.js';

const log = getLogger('InteractionRegistry');

export interface InteractionRouteMetadata {
    data?: any;
    access?: RouteAccessConfig;
}

export type Handler<T> = (interaction: T) => Promise<void>;

export type RegexHandler<T> = (interaction: T, match: RegExpMatchArray) => Promise<void>;

interface RouteEntry<T> {
    handler: Handler<T> | RegexHandler<T>;
    owner?: string;
    metadata?: InteractionRouteMetadata; 
}

interface PatternRoute<T> extends RouteEntry<T> {
    pattern: RegExp;
    handler: RegexHandler<T>;
}

export interface ResolvedRoute<T> {
    handler?: Handler<T>;
    metadata?: InteractionRouteMetadata;
    owner?: string;
}

class RouteStore<T> {
    private readonly exact = new Map<string, RouteEntry<T>>();
    private readonly patterns: PatternRoute<T>[] = [];

    constructor(private readonly routeName: string) {}

    public register(
        id: string | RegExp, 
        handler: Handler<T> | RegexHandler<T>, 
        owner?: string,
        metadata?: any
    ): void {
        if (!handler || typeof handler !== 'function') {
            throw new TypeError(`[${this.routeName}] Router Error: Handler must be a valid function.`);
        }

        if (id instanceof RegExp) {
            this.patterns.push({ pattern: id, handler: handler as RegexHandler<T>, owner, metadata });
            log.debug(`Registered Regex [${this.routeName}]: ${id.source} (Owner: ${owner ?? 'Core'})`);
        } else {
            if (!id || typeof id !== 'string') {
                throw new TypeError(`[${this.routeName}] Router Error: Exact route ID must be a non-empty string.`);
            }
            this.exact.set(id, { handler: handler as Handler<T>, owner, metadata });
            log.debug(`Registered Exact [${this.routeName}]: ${id} (Owner: ${owner ?? 'Core'})`);
        }
    }

    public resolve(id: string): ResolvedRoute<T> | undefined {
        if (!id) return undefined;
        const exactMatch = this.exact.get(id);
        if (exactMatch) {
            return {
                handler: exactMatch.handler as Handler<T>,
                metadata: exactMatch.metadata,
                owner: exactMatch.owner
            };
        }
        for (const route of this.patterns) {
            const match = id.match(route.pattern);
            if (match) {
                return {
                    handler: (interaction: T) => route.handler(interaction, match),
                    metadata: route.metadata,
                    owner: route.owner
                };
            }
        }
        return undefined;
    }

    public getEntries(): Map<string, RouteEntry<T>> {
        return this.exact;
    }

    public unregisterByOwner(ownerId: string): void {
        let count = 0;
        for (const [key, val] of this.exact.entries()) {
            if (val.owner === ownerId) {
                this.exact.delete(key);
                count++;
            }
        }

        for (let i = this.patterns.length - 1; i >= 0; i--) {
            if (this.patterns[i].owner === ownerId) {
                this.patterns.splice(i, 1);
                count++;
            }
        }
        
        if (count > 0) {
            log.debug(`[${this.routeName}] Purged ${count} routes owned by: ${ownerId}`);
        }
    }

    public clear(): void {
        this.exact.clear();
        this.patterns.length = 0;
    }
}

export class InteractionRegistry {
    public readonly chat = new RouteStore<ChatInputCommandInteraction>('ChatCommand');
    public readonly context = new RouteStore<ContextMenuCommandInteraction>('ContextMenu');
    public readonly autocomplete = new RouteStore<AutocompleteInteraction>('Autocomplete');
    public readonly button = new RouteStore<ButtonInteraction>('Button');
    public readonly select = new RouteStore<AnySelectMenuInteraction>('SelectMenu');
    public readonly modal = new RouteStore<ModalSubmitInteraction>('Modal');

    public unregisterPlugin(pluginId: string): void {
        this.chat.unregisterByOwner(pluginId);
        this.context.unregisterByOwner(pluginId);
        this.autocomplete.unregisterByOwner(pluginId);
        this.button.unregisterByOwner(pluginId);
        this.select.unregisterByOwner(pluginId);
        this.modal.unregisterByOwner(pluginId);
    }

    public clearAll(): void {
        this.chat.clear();
        this.context.clear();
        this.autocomplete.clear();
        this.button.clear();
        this.select.clear();
        this.modal.clear();
        log.warn('Interaction Registry fully purged.');
    }
}

export const interactionRegistry = new InteractionRegistry();