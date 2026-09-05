import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '#core/utils/logger.js';
import { commonConfigSchema } from '#core/validation/index.js';

const log = getLogger('Internal:Common777');

export interface InfoMeta {
    __author__: string;
    version: string;
    license?: string;
}

export interface CommonConfig {
    __info__: InfoMeta;
    ENVSettings?: boolean;
    DiscordToken?: string;
    DiscordIntents?: (number | string)[];
    TZ?: string;
    DefaultLocale?: string;
    APIPort?: number;

    [key: string]: any;
}

class Common777 {
    private data: CommonConfig | null = null;
    private authorizedCallerPath: string | null = null;
    private readonly filePath = path.join(process.cwd(), 'common.json');
    private readonly packageJsonPath = path.join(process.cwd(), 'package.json');

    private verifyCallerIdentity(): string {
        const entryPointPath = fs.realpathSync(process.argv[1] ?? '');

        if (!this.authorizedCallerPath) {
            this.authorizedCallerPath = entryPointPath;
            return this.authorizedCallerPath;
        }

        if (this.authorizedCallerPath !== entryPointPath) {
            log.error(
                '\x1b[31m%s\x1b[0m',
                `[SECURITY] Entry point changed during runtime from ${this.authorizedCallerPath} to ${entryPointPath}.`
            );
            process.exit(1);
        }

        return this.authorizedCallerPath;
    }

    private applyEnvConfig(config: CommonConfig): void {
        if (config.ENVSettings === true) {
            log.info('ENVSettings=true: respecting existing process.env, no overrides applied.');
            return;
        }

        if (config.ENVSettings === false) {
            log.info('ENVSettings=false: applying values from common.json into process.env.');
        } else {
            return;
        }

        for (const [key, value] of Object.entries(config)) {
            if (key === 'ENVSettings' || key === '__info__') continue;
            if (value === undefined || value === null) continue;

            let stringValue: string;

            if (Array.isArray(value)) {
                stringValue = value.join(',');
            } else if (typeof value === 'object') {
                stringValue = JSON.stringify(value);
            } else {
                stringValue = String(value);
            }

            process.env[key] = stringValue;
        }
    }

    private loadPackageVersion(): string {
        try {
            const raw = fs.readFileSync(this.packageJsonPath, 'utf-8');
            const pkg = JSON.parse(raw) as { version?: string };
            if (!pkg.version) {
                throw new Error('package.json missing "version" field');
            }
            return pkg.version;
        } catch (err) {
            log.error(`PACKAGE_META_ERROR: ${(err as Error).message}`);
            process.exit(1);
        }
    }

    private validateInfo(info: InfoMeta): InfoMeta {
        if (typeof info.__author__ !== 'string') {
            log.error('__info__.__author__ must be a string');
            process.exit(1);
        }

        if (info.__author__ !== 'Lunedusk') {
            log.error(`__info__.__author__ must be exactly "Lunedusk", got "${info.__author__}"`);
            process.exit(1);
        }

        return info;
    }

    public bootstrap(): CommonConfig {
        if (this.authorizedCallerPath) {
            log.error('CORE_STATE_ERROR: System already bootstrapped.');
            process.exit(1);
        }

        this.authorizedCallerPath = this.verifyCallerIdentity();

        try {
            const pkgVersion = this.loadPackageVersion();

            if (!fs.existsSync(this.filePath)) {
                log.warn('common.json not found. Skipping ENVSettings handling, using in-memory defaults.');
                const defaults: CommonConfig = {
                    __info__: {
                        __author__: 'Lunedusk',
                        version: pkgVersion
                    }
                };
                this.data = defaults;
                return this.data;
            }

            const raw = fs.readFileSync(this.filePath, 'utf-8');
            let parsed: unknown;
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                log.error(`common.json parse error: ${(e as Error).message}`);
                process.exit(1);
            }

            const schemaResult = commonConfigSchema.safeParse(parsed);
            if (!schemaResult.success) {
                const issues = schemaResult.error.issues.map(i =>
                    i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message
                );
                log.error(`common.json schema validation failed: ${issues.join('; ')}`);
                process.exit(1);
            }

            this.data = schemaResult.data as CommonConfig;

            if (!this.data.__info__) {
                this.data.__info__ = {
                    __author__: 'Lunedusk',
                    version: pkgVersion
                };
            }

            this.data.__info__ = this.validateInfo(this.data.__info__);
            this.data.__info__.version = pkgVersion;

            this.applyEnvConfig(this.data);

            log.info('System Common Config initialized and identity locked.');
            return this.data;
        } catch (err) {
            log.error(`Common777 Initialization Failure: ${(err as Error).message}`);
            process.exit(1);
        }
    }

    public get(): CommonConfig {
        this.verifyCallerIdentity();

        if (!this.data) {
            log.error('CORE_STATE_ERROR: Access attempt before bootstrap.');
            process.exit(1);
        }

        return this.data;
    }
}

const instance = new Common777();

export const common777 = Object.freeze({
    bootstrap: () => instance.bootstrap(),
    get: () => instance.get()
});
