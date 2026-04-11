import { type IHeart } from '#core/heart/index.js';

export abstract class BaseEvent<TArgs extends any[] = any[]> {
    public readonly heart: IHeart;
    public abstract readonly name: string;
    public readonly once: boolean = false;
    constructor(heart: IHeart) {
        this.heart = heart;
    }
    public abstract execute(...args: TArgs): void | Promise<void>;
}