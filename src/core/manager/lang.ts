import fs from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';
import { FileWatcher, type WatchEvent } from '#core/watcher/index.js';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { emojis } from './emoji.js';
import { resolveGlobalPlaceholders } from '#core/builders/helpers/string.js';

const log = getLogger('LanguageManager');
const SUPPORTED_LOCALES = new Set(['en', 'es', 'fr', 'de']);

export type TranslationVars = Record<string, string | number | boolean>;
export type CompiledTranslation = (vars?: TranslationVars) => string;

export class LanguageManager {
    private static readonly INTERPOLATION_REGEX = /\{\{\s*([^}]+)\s*\}\}/g;

    private readonly dictionary = new Map<string, Map<string, Map<string, CompiledTranslation>>>();
    
    private readonly liveNamespaces = new Map<string, Map<string, Record<string, CompiledTranslation>>>();
    
    private readonly targetDir: string;
    private watcher: FileWatcher | null = null;
    private readonly loadLocks = new Set<string>();

    constructor(targetDir?: string) {
        this.targetDir = targetDir ? path.resolve(targetDir) : path.join(process.cwd(), 'configuration', 'lang');
    }

    public async init(hotReload: boolean = false): Promise<void> {
        log.info('Initializing Language Manager...');
        
        await fs.mkdir(this.targetDir, { recursive: true });
        
        const files = await fs.readdir(this.targetDir);
        let loadedCount = 0;

        const loadPromises = files
            .filter(file => file.endsWith('.json5'))
            .map(file => this.loadFile(path.join(this.targetDir, file)).then(() => loadedCount++));

        await Promise.all(loadPromises);
        log.info(`Language Manager initialized with ${loadedCount} namespaces.`);

        if (hotReload) {
            this.watcher = new FileWatcher(this.targetDir, { includePatterns: ['*.json5'] });
            
            this.watcher.on('events', async (events: WatchEvent[]) => {
                for (const event of events) {
                    if (event.type === 'deleted') {
                        this.unloadPath(event.path);
                    } else {
                        if (!this.loadLocks.has(event.path)) {
                            this.loadLocks.add(event.path);
                            await this.loadFile(event.path);
                            setTimeout(() => this.loadLocks.delete(event.path), 100);
                        }
                    }
                }
            });
            
            this.watcher.start();
            log.info(`Language Manager hot-reload active.`);
        }
    }

    private parseFilename(filename: string): { namespace: string; locale: string } | null {
        const baseName = path.basename(filename, '.json5');
        const lastUnderscoreIdx = baseName.lastIndexOf('_');
        
        if (lastUnderscoreIdx === -1) {
            log.warn(`Invalid language file format [${baseName}]. Expected: 'namespace_locale.json5'`);
            return null;
        }

        const namespace = baseName.substring(0, lastUnderscoreIdx);
        const locale = baseName.substring(lastUnderscoreIdx + 1);

        if (!SUPPORTED_LOCALES.has(locale)) {
            log.warn(`Unknown locale code '${locale}' in file ${filename}. Using as custom locale.`);
        }

        return { namespace, locale };
    }

    private async loadFile(filePath: string): Promise<void> {
        const meta = this.parseFilename(filePath);
        if (!meta) return;

        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const data = JSON5.parse(raw);

            const flatMap = new Map<string, CompiledTranslation>();
            this.flattenAndCompile(data, '', flatMap);

            if (!this.dictionary.has(meta.locale)) {
                this.dictionary.set(meta.locale, new Map());
            }
            this.dictionary.get(meta.locale)!.set(meta.namespace, flatMap);

            if (!this.liveNamespaces.has(meta.locale)) {
                this.liveNamespaces.set(meta.locale, new Map());
            }
            const localeMap = this.liveNamespaces.get(meta.locale)!;
            
            if (!localeMap.has(meta.namespace)) {
                localeMap.set(meta.namespace, {});
            }
            
            const liveRef = localeMap.get(meta.namespace)!;
            for (const key in liveRef) {
                if (Object.prototype.hasOwnProperty.call(liveRef, key)) delete liveRef[key];
            }
            Object.assign(liveRef, Object.fromEntries(flatMap));

            log.debug(`Loaded [${meta.locale}] namespace: '${meta.namespace}' (${flatMap.size} keys)`);

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`Failed to parse ${path.basename(filePath)}: ${err.message}`);
        }
    }

    private unloadPath(filePath: string): void {
        const meta = this.parseFilename(filePath);
        if (!meta) return;

        const localeMap = this.dictionary.get(meta.locale);
        if (localeMap) {
            localeMap.delete(meta.namespace);
            log.info(`Unloaded [${meta.locale}] namespace: '${meta.namespace}'`);

            if (localeMap.size === 0) {
                this.dictionary.delete(meta.locale);
            }
        }

        const liveLocaleMap = this.liveNamespaces.get(meta.locale);
        const liveRef = liveLocaleMap?.get(meta.namespace);
        if (liveRef) {
            for (const key in liveRef) {
                if (Object.prototype.hasOwnProperty.call(liveRef, key)) delete liveRef[key];
            }
        }
    }

    private flattenAndCompile(obj: Record<string, unknown>, prefix = '', res: Map<string, CompiledTranslation>): void {
        for (const [key, value] of Object.entries(obj)) {
            if (key === '__proto__' || key === 'constructor') continue;

            const newKey = prefix ? `${prefix}.${key}` : key;
            
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                this.flattenAndCompile(value as Record<string, unknown>, newKey, res);
            } else {
                res.set(newKey, this.compileString(String(value)));
            }
        }
    }

    private compileString(template: string): CompiledTranslation {
        if (!template.includes('{{')) {
            return () => resolveGlobalPlaceholders(emojis.parse(template));
        }

        const parts: Array<string | { varName: string }> = [];
        let lastIndex = 0;
        let match;

        LanguageManager.INTERPOLATION_REGEX.lastIndex = 0;

        while ((match = LanguageManager.INTERPOLATION_REGEX.exec(template)) !== null) {
            if (match.index > lastIndex) {
                parts.push(template.slice(lastIndex, match.index));
            }
            parts.push({ varName: match[1].trim() });
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < template.length) {
            parts.push(template.slice(lastIndex));
        }

        return (vars?: TranslationVars) => {
            let result = '';
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (typeof part === 'string') {
                    result += part;
                } else {
                    const val = vars?.[part.varName];
                    result += val !== undefined ? String(val) : `{{${part.varName}}}`;
                }
            }
            
            return resolveGlobalPlaceholders(emojis.parse(result));
        };
    }

    public async reloadFile(namespace: string, locale?: string): Promise<boolean> {
        const masterLocale = secrets.getOptional('DefaultLocale') || 'en';
        const targetLocale = locale || masterLocale;
        const filename = `${namespace}_${targetLocale}.json5`;
        const filePath = path.join(this.targetDir, filename);

        try {
            await fs.access(filePath);
            log.debug(`Manually reloading language file: [${filename}]`);
            await this.loadFile(filePath);
            return true;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`Manual reload failed for [${filename}]: ${err.message}`);
            return false;
        }
    }

    public async reloadAll(): Promise<boolean> {
        log.info('Initiating global language cache refresh...');
        
        try {
            const files = await fs.readdir(this.targetDir);
            const targetFiles = files.filter(file => file.endsWith('.json5'));

            if (targetFiles.length === 0) {
                log.warn('ReloadAll aborted: No language files found in target directory.');
                return false;
            }

            const results = await Promise.allSettled(
                targetFiles.map(file => this.loadFile(path.join(this.targetDir, file)))
            );

            const failed = results.filter(r => r.status === 'rejected').length;
            const success = results.filter(r => r.status === 'fulfilled').length;

            log.info(`Global reload complete. Success: ${success}, Failed: ${failed}`);
            return failed === 0;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`Critical failure during global language reload: ${err.message}`);
            return false;
        }
    }

    public wipeCache(locale?: string): void {
        if (locale) {
            this.dictionary.delete(locale);
            const liveLocaleMap = this.liveNamespaces.get(locale);
            if (liveLocaleMap) {
                for (const [, liveRef] of liveLocaleMap) {
                    for (const key in liveRef) delete liveRef[key];
                }
                this.liveNamespaces.delete(locale);
            }
            log.warn(`Language cache for locale [${locale}] has been purged.`);
        } else {
            this.dictionary.clear();
            for (const [, liveLocaleMap] of this.liveNamespaces) {
                for (const [, liveRef] of liveLocaleMap) {
                    for (const key in liveRef) delete liveRef[key];
                }
            }
            this.liveNamespaces.clear();
            log.warn('Global language dictionary has been purged.');
        }
    }

    public getNamespace(namespace: string, locale?: string): Readonly<Record<string, CompiledTranslation>> {
        const masterLocale = secrets.getOptional('DefaultLocale') || 'en';
        const targetLocale = locale || masterLocale;

        if (!this.liveNamespaces.has(targetLocale)) {
            this.liveNamespaces.set(targetLocale, new Map());
        }
        const localeMap = this.liveNamespaces.get(targetLocale)!;
        if (!localeMap.has(namespace)) {
            localeMap.set(namespace, {});
        }
        return localeMap.get(namespace)!;
    }

    public get(namespace: string, key: string, variables?: TranslationVars, requestedLocale?: string): string {
        const masterLocale = secrets.getOptional('DefaultLocale') || 'en';
        const targetLocale = requestedLocale || masterLocale;

        const fallbacks = [targetLocale];
        const baseLocale = targetLocale.split('-')[0];
        
        if (baseLocale !== targetLocale) fallbacks.push(baseLocale);
        if (masterLocale !== targetLocale && masterLocale !== baseLocale) fallbacks.push(masterLocale);
        if (!fallbacks.includes('en')) fallbacks.push('en');

        for (let i = 0; i < fallbacks.length; i++) {
            const loc = fallbacks[i];
            const compiledFn = this.dictionary.get(loc)?.get(namespace)?.get(key);
            
            if (compiledFn) {
                return compiledFn(variables);
            }
        }

        log.warn(`Missing translation key: [${namespace}] -> '${key}'`);
        return `${namespace}:${key}`;
    }
}

export const i18n = new LanguageManager();