import {
    WebhookClient,
    TextChannel,
    type MessageCreateOptions,
} from 'discord.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';
import type { BasePlugin } from '#core/bases/Plugin.js';
type IHeart = BasePlugin['heart'];
import type { LogErrorPayload } from '#core/utils/logger.js';
import type { UnhandledErrorPayload } from '#core/error/index.js';
import { buildComponentsV2 } from '#core/builders/index.js';
import type { Cv2LayoutSpec, Cv2BuildContext } from '#core/builders/index.js';
import { resolveGlobalPlaceholders } from '#core/builders/helpers/string.js';
import { redactSensitiveData } from '#core/utils/redaction.js';


interface ReporterConfig {
    enabled: boolean;
    channelId: string;
    webhookUrl: string;
    reportLogErrors: boolean;
    reportUnhandled: boolean;
    maxStackLines: number;
    maxMessageLength: number;
    dedupWindowMs: number;
    rateLimitPerMinute: number;
    logErrorAccentColor: number;
    unhandledAccentColor: number;
}

interface LangSpec {
    components: {
        logError:  { container: any };
        unhandled: { container: any };
    };
    [key: string]: any;
}

export class ErrorReporterService {
    private cfg!: Readonly<ReporterConfig>;
    private lang!: LangSpec;
    private webhookClient: WebhookClient | null = null;

    private readonly dedupCache = new Map<string, number>();
    private deliveryCount = 0;
    private windowResetAt = Date.now() + 60_000;

    private static readonly INTERNAL_MODULES = new Set([
        'GlobalCatcher',
        'EventBus',
    ]);

    constructor(private readonly heart: IHeart) {}

    public async init(): Promise<void> {
        const raw = this.heart.assets.config.get<ReporterConfig>('error-reporter');
        if (!raw) throw new Error('[error-reporter] Config block missing — ensure config.json5 is present.');
        this.cfg = raw as ReporterConfig;

        const langPath = resolve(
            fileURLToPath(new URL('../../../../../../..', import.meta.url)),
            'configuration', 'lang', 'error-reporter_en.json5'
        );

        try {
            const src = await readFile(langPath, 'utf-8');
            this.lang = JSON5.parse(src) as LangSpec;
        } catch {
            const fallbackPath = resolve(
                fileURLToPath(new URL('../..', import.meta.url)),
                'data', 'configuration', 'lang', 'en.json5'
            );
            const src = await readFile(fallbackPath, 'utf-8');
            this.lang = JSON5.parse(src) as LangSpec;
        }

        if (!this.cfg.enabled) return;

        if (this.cfg.webhookUrl) {
            this.webhookClient = new WebhookClient({ url: this.cfg.webhookUrl });
        }
    }

    public async destroy(): Promise<void> {
        this.webhookClient?.destroy();
        this.webhookClient = null;
    }

    public async handleLogError(payload: LogErrorPayload): Promise<void> {
        if (!this.cfg.enabled || !this.cfg.reportLogErrors) return;
        const safePayload = redactSensitiveData(payload) as LogErrorPayload;
        if (ErrorReporterService.INTERNAL_MODULES.has(safePayload.name)) return;
        if (this.isDuplicate(safePayload.message) || this.isRateLimited()) return;
        await this.deliver(this.buildLogErrorMessage(safePayload));
    }

    public async handleUnhandledError(payload: UnhandledErrorPayload): Promise<void> {
        if (!this.cfg.enabled || !this.cfg.reportUnhandled) return;
        const safePayload = redactSensitiveData(payload) as UnhandledErrorPayload;
        if (this.isDuplicate(safePayload.message) || this.isRateLimited()) return;
        await this.deliver(this.buildUnhandledErrorMessage(safePayload));
    }

    private buildLogErrorMessage(payload: LogErrorPayload): MessageCreateOptions {
        const containerSpec = this.lang.components.logError.container;

        const truncMsg   = this.truncate(payload.message, this.cfg.maxMessageLength);
        const stackLines = this.formatStack(payload.stack);
        const pluginName = this.resolvePluginName(payload.name, payload.stack);

        const vars: Record<string, string> = {
            module:      payload.name,
            message:     truncMsg,
            stack:       stackLines,
            timestamp:   payload.timestamp,
            plugin_name: pluginName,
        };

        const children = this.interpolate(containerSpec.children, vars);

        const spec: Cv2LayoutSpec = {
            version: 1,
            components: [
                {
                    ...containerSpec,
                    type: 'container',
                    accentColor: this.cfg.logErrorAccentColor,
                    children,
                },
            ],
        };

        const result = buildComponentsV2(spec, { variables: vars } as Cv2BuildContext, { autoWrapInteractives: true });
        return { components: result.components as any[], files: result.files, flags: result.flags };
    }

    private buildUnhandledErrorMessage(payload: UnhandledErrorPayload): MessageCreateOptions {
        const containerSpec = this.lang.components.unhandled.container;

        const truncMsg   = this.truncate(payload.message, this.cfg.maxMessageLength);
        const stackLines = this.formatStack(payload.stack);
        const origin     = payload.origin ?? 'unknown';
        const errorType  = payload.type === 'uncaughtException' ? 'Uncaught Exception' : 'Unhandled Rejection';
        const pluginName = this.resolvePluginName(undefined, payload.stack);

        const vars: Record<string, string> = {
            errorType,
            origin,
            message:     truncMsg,
            stack:       stackLines,
            timestamp:   payload.timestamp,
            plugin_name: pluginName,
        };

        const children = this.interpolate(containerSpec.children, vars);

        const spec: Cv2LayoutSpec = {
            version: 1,
            components: [
                {
                    ...containerSpec,
                    type: 'container',
                    accentColor: this.cfg.unhandledAccentColor,
                    children,
                },
            ],
        };

        const result = buildComponentsV2(spec, { variables: vars } as Cv2BuildContext, { autoWrapInteractives: true });
        return { components: result.components as any[], files: result.files, flags: result.flags };
    }

    private async deliver(message: MessageCreateOptions): Promise<void> {
        try {
            const safeMessage = redactSensitiveData(message) as MessageCreateOptions;

            if (this.webhookClient) {
                await this.webhookClient.send(safeMessage);
                return;
            }

            if (this.cfg.channelId) {
                const channel = this.heart.client.channels.cache.get(this.cfg.channelId);
                if (channel instanceof TextChannel) {
                    await channel.send(safeMessage);
                    return;
                }
                this.heart.log.warn(`[error-reporter] Channel ${this.cfg.channelId} not found or not a text channel.`);
            }
        } catch (err) {
            console.error('[error-reporter] Delivery failed:', (err as Error).message);
        }
    }

    private resolvePluginName(moduleName?: string, stack?: string): string {
        if (moduleName && moduleName.toLowerCase().startsWith('plugin:')) {
            const pluginId = moduleName.split(':')[1]?.trim();
            if (pluginId) {
                const plugin = (this.heart as any).plugins?.get(pluginId);
                if (plugin?.manifest?.name) return plugin.manifest.name;
                return this.formatPluginName(pluginId);
            }
        }

        if (stack) {
            const match = stack.match(/[\\/]plugins[\\/]([^\\/]+)/);
            if (match && match[1]) {
                const pluginId = match[1];
                const plugin = (this.heart as any).plugins?.get(pluginId);
                if (plugin?.manifest?.name) return plugin.manifest.name;
                return this.formatPluginName(pluginId);
            }
        }

        return 'NovaX Core';
    }


    private formatPluginName(rawId: string): string {
        return rawId
            .replace(/[-_]+/g, ' ') 
            .split(' ')
            .filter(Boolean)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }

    private interpolate(node: any, vars: Record<string, string>): any {
        if (typeof node === 'string') {
            let str = node;
            
            str = str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
            str = str.replace(/%%plugin_name%%/g, vars['plugin_name']);
            str = resolveGlobalPlaceholders(str);
            
            return str;
        }

        if (Array.isArray(node)) {
            return node.map(item => this.interpolate(item, vars));
        }

        if (node && typeof node === 'object') {
            const clone: Record<string, any> = {};
            for (const [key, value] of Object.entries(node)) {
                clone[key] = this.interpolate(value, vars);
            }
            return clone;
        }

        return node;
    }

    private formatStack(stack?: string): string {
        if (!stack) return '_No stack trace available._';
        const lines = stack.split('\n').slice(0, this.cfg.maxStackLines);
        return '```\n' + lines.join('\n') + '\n```';
    }

    private truncate(str: string, max: number): string {
        if (str.length <= max) return str;
        return str.slice(0, max - 3) + '...';
    }

    private isDuplicate(message: string): boolean {
        const now  = Date.now();
        const last = this.dedupCache.get(message);

        if (this.dedupCache.size > 500) {
            const cutoff = now - this.cfg.dedupWindowMs;
            for (const [k, v] of this.dedupCache) {
                if (v < cutoff) this.dedupCache.delete(k);
            }
        }

        if (last !== undefined && now - last < this.cfg.dedupWindowMs) return true;
        this.dedupCache.set(message, now);
        return false;
    }

    private isRateLimited(): boolean {
        const now = Date.now();
        if (now > this.windowResetAt) {
            this.deliveryCount = 0;
            this.windowResetAt = now + 60_000;
        }
        if (this.deliveryCount >= this.cfg.rateLimitPerMinute) return true;
        this.deliveryCount++;
        return false;
    }
}