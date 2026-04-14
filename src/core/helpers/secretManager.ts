import crypto from 'node:crypto';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('SecretManager');

export class VaultError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}
export class VaultSealedError extends VaultError {}
export class VaultDecryptionError extends VaultError {}
export class VaultMissingKeyError extends VaultError {}

interface EncryptedPayload {
    iv: Buffer;
    authTag: Buffer;
    ciphertext: Buffer;
}

export class SecretManager {
    readonly #ephemeralKey: Buffer;
    readonly #store = new Map<string, EncryptedPayload>();
    #isLocked = false;

    static readonly DEFAULT_SENSITIVE_PATTERN = /(TOKEN|SECRET|KEY|PASSWORD|URI|DB|DATABASE|LICENSE|CERT|AUTH)/i;

    constructor() {
        this.#ephemeralKey = crypto.randomBytes(32);
        Object.freeze(SecretManager.prototype);
    }

    public set(key: string, value: string): void {
        if (this.#isLocked && this.#store.has(key)) {
            log.warn(`Security Violation: Blocked attempted mutation of sealed secret [${key}].`);
            throw new VaultSealedError(`Security Violation: Secret [${key}] is sealed and cannot be overwritten.`);
        }

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.#ephemeralKey, iv);

        const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();

        this.#store.set(key, { iv, authTag, ciphertext });
        log.debug(`Variable [${key}] encrypted and stored in memory vault.`);
    }

    public get(key: string): string {
        const payload = this.#store.get(key);
        if (!payload) {
            throw new VaultMissingKeyError(`Vault Error: Secret/Config [${key}] does not exist.`);
        }

        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.#ephemeralKey, payload.iv);
            decipher.setAuthTag(payload.authTag);

            const decryptedBuffer = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
            const plainText = decryptedBuffer.toString('utf8');

            decryptedBuffer.fill(0);

            return plainText;
        } catch (error) {
            log.fatal(`Integrity compromise detected on vault item [${key}].`);
            throw new VaultDecryptionError(`Memory Vault decryption failed for [${key}].`);
        }
    }

    public getOptional(key: string, fallback?: string): string | undefined {
        if (!this.#store.has(key)) return fallback;
        return this.get(key);
    }

    public assimilateEnv(pattern: RegExp = SecretManager.DEFAULT_SENSITIVE_PATTERN): void {
        if (this.#isLocked) {
            log.debug('Vault is already locked. Skipping redundant environment assimilation.');
            return;
        }
        let assimilatedCount = 0;
        let scrubbedCount = 0;

        for (const envKey of Object.keys(process.env)) {
            const value = process.env[envKey];
            if (!value) continue;

            this.set(envKey, value);
            assimilatedCount++;

            if (pattern.test(envKey)) {
                delete process.env[envKey];
                scrubbedCount++;
            }
        }

        log.info(`Vault loaded ${assimilatedCount} environment variables (Scrubbed ${scrubbedCount} sensitive keys from global scope).`);
    }

    public getBoolean(key: string, fallback = false): boolean {
        const val = this.getOptional(key);
        
        if (val === undefined || val === null) return fallback;
        if (typeof val === 'boolean') return val;
        
        if (typeof val === 'string') {
            const normalized = val.trim().toLowerCase();
            return normalized === 'true' || normalized === '1' || normalized === 'yes';
        }
        
        return false;
    }

    public lock(): void {
        this.#isLocked = true;
        log.info('Memory Vault is now locked in Append-Only mode. Core configs are sealed.');
    }

    public has(key: string): boolean {
        return this.#store.has(key);
    }

    public keys(): string[] {
        return Array.from(this.#store.keys());
    }
}

export const secrets = Object.freeze(new SecretManager());