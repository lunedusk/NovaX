import { type IHeart } from '#core/heart/index.js';
import type { ButtonInteraction, ModalSubmitInteraction, AnySelectMenuInteraction } from 'discord.js';

export abstract class BaseEvent<TArgs extends any[] = any[]> {
    public readonly heart: IHeart;
    public abstract readonly name: string;
    public readonly once: boolean = false;
    public buttons?: Map<string | RegExp, (interaction: ButtonInteraction, match?: RegExpMatchArray) => Promise<void>>;
    public modals?: Map<string | RegExp, (interaction: ModalSubmitInteraction, match?: RegExpMatchArray) => Promise<void>>;
    public selects?: Map<string | RegExp, (interaction: AnySelectMenuInteraction, match?: RegExpMatchArray) => Promise<void>>;

    constructor(heart: IHeart) {
        this.heart = heart;
    }
    
    public abstract execute(...args: TArgs): void | Promise<void>;
}