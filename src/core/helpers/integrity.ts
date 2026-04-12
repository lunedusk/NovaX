import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('IntegrityManager');
export class IntegrityError extends Error { 
    constructor(msg: string, options?: ErrorOptions) { super(msg, options); this.name = this.constructor.name; } 
}
export class ManifestSignatureError extends IntegrityError {}
export class FileTamperingError extends IntegrityError {}

export interface FileMetadata {
    hash: string;
    algorithm: string;
    size: number;
}

export interface IntegrityManifest {
    signature?: string;
    files: Record<string, FileMetadata>;
    timestamp: number;
}

export class IntegrityManager {
    static readonly #EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'dist', '.data', 'logs', 'configuration', 'data']);
    static readonly #EXCLUDE_EXTENSIONS = new Set(['.log', '.tmp', '.map', '.env']);
    static readonly #MAX_CONCURRENCY = 50;

    static #toCanonicalString(obj: unknown): string {
        if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
        
        if (Array.isArray(obj)) {
            return '[' + obj.map(item => this.#toCanonicalString(item)).join(',') + ']';
        }

        const sortedKeys = Object.keys(obj).sort();
        const result = sortedKeys.map(key => {
            return `${JSON.stringify(key)}:${this.#toCanonicalString((obj as Record<string, unknown>)[key])}`;
        });
        
        return '{' + result.join(',') + '}';
    }

    static async #runConcurrently(tasks: (() => Promise<void>)[]): Promise<void> {
        const executing = new Set<Promise<void>>();
        for (const task of tasks) {
            const p = task().finally(() => executing.delete(p));
            executing.add(p);
            if (executing.size >= this.#MAX_CONCURRENCY) {
                await Promise.race(executing);
            }
        }
        await Promise.all(executing);
    }

    public static async calculateFileStats(filePath: string, algo: string = 'sha384'): Promise<FileMetadata> {
        const hasher = createHash(algo);
        let size = 0;

        await pipeline(
            createReadStream(filePath),
            async function* (source) {
                for await (const chunk of source) {
                    size += chunk.length;
                    hasher.update(chunk);
                    yield chunk;
                }
            }
        );

        return {
            hash: hasher.digest('hex'),
            algorithm: algo,
            size
        };
    }

    public static async generateKeys(privateKeyPath: string): Promise<string> {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        
        const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' });
        const publicRaw = publicKey.export({ format: 'der', type: 'spki' });
        
        await fs.mkdir(path.dirname(privateKeyPath), { recursive: true });
        await fs.writeFile(privateKeyPath, privatePem, 'utf-8');
        
        log.info('Ed25519 Integrity Keys generated successfully.');
        return Buffer.from(publicRaw).toString('base64');
    }

    static async *#discoverFiles(dir: string, root = dir): AsyncGenerator<{ fullPath: string; relPath: string }> {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const res = path.resolve(dir, entry.name);
            
            if (entry.isSymbolicLink()) {
                log.warn(`[SECURITY] Symbolic link detected and ignored: ${res}`);
                continue;
            }

            if (entry.isDirectory()) {
                if (this.#EXCLUDE_DIRS.has(entry.name)) continue;
                yield* this.#discoverFiles(res, root);
            } else {
                if (this.#EXCLUDE_EXTENSIONS.has(path.extname(entry.name)) || entry.name === 'manifest.json') continue;
                yield { fullPath: res, relPath: path.relative(root, res).replace(/\\/g, '/') };
            }
        }
    }

    public static async generate(rootDir: string, privateKeyPath: string, manifestFile = 'manifest.json'): Promise<void> {
        const files: Record<string, FileMetadata> = {};
        const tasks: (() => Promise<void>)[] = [];

        for await (const { fullPath, relPath } of this.#discoverFiles(rootDir)) {
            tasks.push(async () => {
                files[relPath] = await this.calculateFileStats(fullPath);
            });
        }

        await this.#runConcurrently(tasks);

        const privatePem = await fs.readFile(privateKeyPath, 'utf-8');
        const privateKey = createPrivateKey(privatePem);
        const canonicalData = this.#toCanonicalString(files);
        const signature = sign(null, Buffer.from(canonicalData), privateKey).toString('base64');

        const payload: IntegrityManifest = {
            signature,
            files,
            timestamp: Date.now()
        };

        const manifestPath = path.resolve(rootDir, manifestFile);
        const tempPath = `${manifestPath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(payload, null, 2));
        await fs.rename(tempPath, manifestPath);
        
        log.info(`Project locked. Manifest generated with ${Object.keys(files).length} files.`);
    }

    public static async verify(rootDir: string, publicKeyB64: string, manifestFile = 'manifest.json'): Promise<boolean> {
        const manifestPath = path.resolve(rootDir, manifestFile);
        
        let rawMeta: string;
        try {
            rawMeta = await fs.readFile(manifestPath, 'utf-8');
        } catch (error) {
            throw new IntegrityError('Manifest file not found. System integrity cannot be verified.', { cause: error });
        }
        
        const payload: IntegrityManifest = JSON.parse(rawMeta);

        if (
            !payload || 
            typeof payload !== 'object' || 
            typeof payload.signature !== 'string' || 
            !payload.files || 
            typeof payload.files !== 'object'
        ) {
            throw new IntegrityError('Manifest schema validation failed. Potential Type Juggling attack detected.');
        }

        const publicKey = createPublicKey({
            key: Buffer.from(publicKeyB64, 'base64'),
            format: 'der',
            type: 'spki'
        });

        const canonicalData = this.#toCanonicalString(payload.files);
        const isAuthentic = verify(null, Buffer.from(canonicalData), publicKey, Buffer.from(payload.signature, 'base64'));

        if (!isAuthentic) {
            throw new ManifestSignatureError('CRITICAL: Manifest signature is invalid. The manifest itself was tampered with.');
        }

        const scannedFiles = new Set<string>();
        const mismatches: string[] = [];
        const tasks: (() => Promise<void>)[] = [];

        for await (const { fullPath, relPath } of this.#discoverFiles(rootDir)) {
            scannedFiles.add(relPath);
            const expected = payload.files[relPath];

            if (!expected) {
                log.error(`[UNAUTHORIZED ADDITION] File detected: ${relPath}`);
                mismatches.push(relPath);
                continue;
            }

            if (typeof expected.hash !== 'string' || typeof expected.size !== 'number') {
                log.error(`[CORRUPT METADATA] Invalid manifest entry for: ${relPath}`);
                mismatches.push(relPath);
                continue;
            }

            tasks.push(async () => {
                const current = await this.calculateFileStats(fullPath, expected.algorithm || 'sha384');
                
                const expectedHashBuf = Buffer.from(expected.hash, 'hex');
                const currentHashBuf = Buffer.from(current.hash, 'hex');

                if (
                    current.size !== expected.size || 
                    expectedHashBuf.length !== currentHashBuf.length || 
                    !timingSafeEqual(expectedHashBuf, currentHashBuf)
                ) {
                    log.error(`[MODIFIED/CORRUPTED] Integrity breach: ${relPath}`);
                    mismatches.push(relPath);
                }
            });
        }

        await this.#runConcurrently(tasks);

        for (const expectedRelPath of Object.keys(payload.files)) {
            if (!scannedFiles.has(expectedRelPath)) {
                log.error(`[DELETED] Required file missing: ${expectedRelPath}`);
                mismatches.push(expectedRelPath);
            }
        }

        if (mismatches.length > 0) {
            throw new FileTamperingError(`Integrity check failed: ${mismatches.length} unauthorized alterations detected.`);
        }

        log.info('System integrity verified. Authentic and unmodified.');
        return true;
    }
}