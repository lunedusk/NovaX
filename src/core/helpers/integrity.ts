import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('Integrity');

export class IntegrityError extends Error { constructor(msg: string) { super(msg); this.name = 'IntegrityError'; } }
export class MetadataSignatureError extends IntegrityError { constructor(msg: string) { super(msg); this.name = 'MetadataSignatureError'; } }

export interface FileMetadata {
    hash: string;
    algorithm: string;
    size: number;
}

export interface IntegrityPayload {
    signature?: string;
    files: Record<string, FileMetadata>;
    timestamp: number;
}

const IGNORE_EXTENSIONS = new Set(['.log', '.tmp', '.map', '.json']);

export class IntegrityManager {
    private static toCanonicalString(obj: any): string {
        if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
        
        if (Array.isArray(obj)) {
            return '[' + obj.map(this.toCanonicalString.bind(this)).join(',') + ']';
        }

        const sortedKeys = Object.keys(obj).sort();
        const result = sortedKeys.map(key => {
            return `${JSON.stringify(key)}:${this.toCanonicalString(obj[key])}`;
        });
        
        return '{' + result.join(',') + '}';
    }

    public static async calculateFileStats(filePath: string, algo: string = 'sha256'): Promise<FileMetadata> {
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
        
        return Buffer.from(publicRaw).toString('base64');
    }

    private static async signPayload(files: Record<string, FileMetadata>, privateKeyPath: string): Promise<string> {
        const privatePem = await fs.readFile(privateKeyPath, 'utf-8');
        const privateKey = createPrivateKey(privatePem);
        
        const canonicalData = this.toCanonicalString(files);
        const signature = sign(null, Buffer.from(canonicalData), privateKey);
        
        return signature.toString('base64');
    }

    public static async verify(rootDir: string, publicKeyB64: string, metadataFile = 'metadata.json'): Promise<boolean> {
        const metaPath = path.resolve(rootDir, metadataFile);
        const rawMeta = await fs.readFile(metaPath, 'utf-8');
        const payload: IntegrityPayload = JSON.parse(rawMeta);

        if (!payload.signature || !payload.files) {
            throw new IntegrityError("Metadata file is missing signature or file definitions.");
        }

        const publicKey = createPublicKey({
            key: Buffer.from(publicKeyB64, 'base64'),
            format: 'der',
            type: 'spki'
        });

        const canonicalData = this.toCanonicalString(payload.files);
        const isValid = verify(null, Buffer.from(canonicalData), publicKey, Buffer.from(payload.signature, 'base64'));

        if (!isValid) throw new MetadataSignatureError("The metadata file signature is invalid. AUTHENTICITY FAILED.");

        const scannedFiles = new Set<string>();
        const mismatches: string[] = [];

        const excludeDirs = new Set(['.git', 'node_modules', 'dist', '.data']);
        const excludeFiles = new Set([metadataFile]);

        for await (const { fullPath, relPath } of this.iterFiles(rootDir, excludeDirs, excludeFiles)) {
            scannedFiles.add(relPath);
            const expected = payload.files[relPath];

            if (!expected) {
                log.warn(`[UNAUTHORIZED] New file detected: ${relPath}`);
                mismatches.push(relPath);
                continue;
            }

            const current = await this.calculateFileStats(fullPath, expected.algorithm);
            if (current.hash !== expected.hash || current.size !== expected.size) {
                log.error(`[MODIFIED] Integrity breach: ${relPath}`);
                mismatches.push(relPath);
            }
        }

        for (const expectedRelPath of Object.keys(payload.files)) {
            if (!scannedFiles.has(expectedRelPath)) {
                log.error(`[DELETED] File missing: ${expectedRelPath}`);
                mismatches.push(expectedRelPath);
            }
        }

        if (mismatches.length > 0) {
            throw new IntegrityError(`Integrity check failed: ${mismatches.length} unauthorized changes.`);
        }

        log.info("Project integrity verified. Authentic and unmodified.");
        return true;
    }

    private static async *iterFiles(dir: string, excludeDirs: Set<string>, excludeFiles: Set<string>, root = dir): AsyncGenerator<{ fullPath: string; relPath: string }> {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const res = path.resolve(dir, entry.name);
            if (entry.isDirectory()) {
                if (excludeDirs.has(entry.name)) continue;
                yield* this.iterFiles(res, excludeDirs, excludeFiles, root);
            } else {
                if (excludeFiles.has(entry.name) || IGNORE_EXTENSIONS.has(path.extname(entry.name))) continue;
                yield { fullPath: res, relPath: path.relative(root, res).replace(/\\/g, '/') };
            }
        }
    }

    public static async generate(rootDir: string, privateKeyPath: string, metadataFile = 'metadata.json'): Promise<void> {
        const excludeDirs = new Set(['.git', 'node_modules', 'dist', '.data']);
        const excludeFiles = new Set([metadataFile]);
        const files: Record<string, FileMetadata> = {};

        for await (const { fullPath, relPath } of this.iterFiles(rootDir, excludeDirs, excludeFiles)) {
            files[relPath] = await this.calculateFileStats(fullPath);
        }

        const signature = await this.signPayload(files, privateKeyPath);
        const payload: IntegrityPayload = {
            signature,
            files,
            timestamp: Date.now()
        };

        const tempPath = `${path.resolve(rootDir, metadataFile)}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(payload, null, 2));
        await fs.rename(tempPath, path.resolve(rootDir, metadataFile));
        
        log.info(`Integrity manifest generated and signed: ${metadataFile}`);
    }
}