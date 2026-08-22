import { type IHeart } from '#core/heart/index.js';
import { 
    type ChatInputCommandInteraction, 
    type AutocompleteInteraction,
    SlashCommandBuilder,
    type PermissionResolvable
} from 'discord.js';
import { resolveGlobalPlaceholders } from '#core/placeholder/index.js';

export interface CommandConfig {
    readonly cooldown?: number;
    readonly devOnly?: boolean;
    readonly permissionLevel?: string;
    readonly roleIds?: string[];
    readonly userIds?: string[];
    readonly userPermissions?: PermissionResolvable[];
    readonly clientPermissions?: PermissionResolvable[];
    readonly allowInDm?: boolean;
    readonly denyMessage?: string;
    readonly autoDefer?: boolean | 'ephemeral';
}

export abstract class BaseCommand {
    public abstract readonly data: SlashCommandBuilder | any;
    public readonly config: CommandConfig = { autoDefer: false };
    constructor(protected readonly heart: IHeart) {}
    public async onBeforeExecute?(interaction: ChatInputCommandInteraction): Promise<boolean>;
    public abstract execute(interaction: ChatInputCommandInteraction): Promise<void>;
    public async onAfterExecute?(interaction: ChatInputCommandInteraction): Promise<void>;
    
    public async onError(error: Error, interaction: ChatInputCommandInteraction): Promise<void> {
        this.heart.log.error(`Command [${this.data.name}] failed: ${error.message}`, { stack: error.stack });
        
        const msg = resolveGlobalPlaceholders('%%emoji_cross%% An error occurred while executing this command.');
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
        } else {
            await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
        }
    }

    public async autocomplete?(interaction: AutocompleteInteraction): Promise<void>;

    protected get log() { return this.heart.log; }
    
    protected t(key: string, vars?: Record<string, string | number>, locale?: string): string {
        return this.heart.assets.lang.get(this.heart.id, key, vars, locale);
    }
}