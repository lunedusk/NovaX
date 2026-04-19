import { type IHeart } from '#core/heart/index.js';
import { getLogger, type Logger } from '#core/utils/logger.js';

export enum PluginState {
    Unloaded = 'UNLOADED',
    Setup = 'SETUP',
    Enabled = 'ENABLED',
    Disabled = 'DISABLED',
    Error = 'ERROR'
}

export interface PluginManifest {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly author?: string;
    readonly dependencies?: string[];
    readonly novax_version?: string;
    readonly node_version?: string;
}

export abstract class BasePlugin {
    #heart?: IHeart;
    #state: PluginState = PluginState.Unloaded;
    #logger?: Logger;
    public abstract readonly manifest: PluginManifest;
    public get state(): PluginState { 
        return this.#state;
    }
    public get isEnabled(): boolean { 
        return this.#state === PluginState.Enabled; 
    }
    public _injectCore(heart: IHeart): void {
        if (this.#heart) {
            throw new Error(`[${this.manifest.id}] Core system already injected. Cannot re-inject.`);
        }
        this.#heart = heart;
    }
    public _setState(newState: PluginState): void {
        this.#state = newState;
    }
    protected get heart(): IHeart {
        if (!this.#heart) {
            throw new Error(`[${this.manifest.id}] Attempted to access Heart before injection. Ensure you are not accessing it in the constructor.`);
        }
        return this.#heart;
    }
    protected get log(): Logger {
        if (!this.#logger) {
            this.#logger = getLogger(`Plugin:${this.manifest.id}`);
        }
        return this.#logger;
    }
    public async onSetup(): Promise<void> {}
    public abstract onEnable(): Promise<void>;
    public async onDisable(): Promise<void> {}
}