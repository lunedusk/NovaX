import { type IHeart } from '#core/heart/index.js';
import { getLogger, type Logger } from '#core/utils/logger.js';

export abstract class BaseHandler {
    #heart: IHeart;
    #logger?: Logger;

    public abstract readonly name: string;
    public readonly version?: string;
    public readonly description?: string;

    constructor(heart: IHeart) {
        this.#heart = heart;
    }

    protected get heart(): IHeart {
        return this.#heart;
    }

    protected get log(): Logger {
        if (!this.#logger) {
            this.#logger = getLogger(`Handler:${this.constructor.name}`);
        }
        return this.#logger;
    }

    protected get config() {
        return this.#heart.assets.config;
    }

    protected get events() {
        return this.#heart.system.events;
    }

    public async onInitialize(): Promise<void> {}
    public async onTeardown(): Promise<void> {}
}

export type { BaseHandler as BaseHandlerType };