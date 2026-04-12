import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import * as flatbuffers from 'flatbuffers';
import { getLogger } from '#core/utils/logger.js';

import { HybridVault } from '#core/helpers/enclave.js';

import { Manifest } from '#core/flatbuffer/nova-x/integrity/manifest.js';
import { FileEntry } from '#core/flatbuffer/nova-x/integrity/file-entry.js';

const log = getLogger('IntegrityManager');

export class IntegrityError extends Error { 
    constructor(msg: string, options?: ErrorOptions) { super(msg, options); this.name = this.constructor.name; } 
}
export class ManifestSignatureError extends IntegrityError {}
export class FileTamperingError extends IntegrityError {}

export interface FileMetadata {
    hash: string;
    size: number;
}

export class IntegrityManager {
    static readonly #EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'dist', '.data', 'logs', 'configuration', 'data']);
    static readonly #EXCLUDE_EXTENSIONS = new Set(['.log', '.tmp', '.map', '.env', '.bin', '.nc']);
    static readonly #MAX_CONCURRENCY = 50;
    static readonly #ALGORITHM = 'sha384';

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

    public static async calculateFileStats(filePath: string): Promise<FileMetadata> {
        const hasher = createHash(this.#ALGORITHM);
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
            size
        };
    }

    public static async generateSignatureKeys(privateKeyPath: string): Promise<string> {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        await fs.mkdir(path.dirname(privateKeyPath), { recursive: true });
        await fs.writeFile(privateKeyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }), 'utf-8');
        await fs.chmod(privateKeyPath, 0o600);
        return Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).toString('base64');
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
                if (this.#EXCLUDE_EXTENSIONS.has(path.extname(entry.name)) || entry.name.startsWith('manifest')) continue;
                yield { fullPath: res, relPath: path.relative(root, res).replace(/\\/g, '/') };
            }
        }
    }

    public static async generate(
        rootDir: string, 
        signingPrivKeyPem: string, 
        encryptionPubKeyPem: string, 
        manifestFile = 'manifest.bin'
    ): Promise<void> {
        const files: Record<string, FileMetadata> = {};
        const tasks: (() => Promise<void>)[] = [];

        for await (const { fullPath, relPath } of this.#discoverFiles(rootDir)) {
            tasks.push(async () => {
                files[relPath] = await this.calculateFileStats(fullPath);
            });
        }
        await this.#runConcurrently(tasks);
        const builder = new flatbuffers.Builder(1024 * 64);
        const fileOffsets: number[] = [];
        
        const sortedPaths = Object.keys(files).sort();
        for (const relPath of sortedPaths) {
            const file = files[relPath];
            const pathOffset = builder.createString(relPath);
            
            const hashBuf = Buffer.from(file.hash, 'hex');
            const hashOffset = FileEntry.createHashVector(builder, hashBuf);

            FileEntry.startFileEntry(builder);
            FileEntry.addPath(builder, pathOffset);
            FileEntry.addHash(builder, hashOffset);
            FileEntry.addSize(builder, file.size);
            fileOffsets.push(FileEntry.endFileEntry(builder));
        }

        const filesVecOffset = Manifest.createFilesVector(builder, fileOffsets);
        const algoOffset = builder.createString(this.#ALGORITHM);

        Manifest.startManifest(builder);
        Manifest.addTimestamp(builder, BigInt(Date.now()));
        Manifest.addAlgorithm(builder, algoOffset);
        Manifest.addFiles(builder, filesVecOffset);
        builder.finish(Manifest.endManifest(builder));

        const fbPayload = Buffer.from(builder.asUint8Array());

        const signKey = createPrivateKey(signingPrivKeyPem);
        const signature = sign(null, fbPayload, signKey);

        const signedPayload = Buffer.concat([signature, fbPayload]);

        const vault = new HybridVault(undefined, encryptionPubKeyPem);
        const encryptedManifest = await vault.pack(signedPayload, 'bytes', true);

        const manifestPath = path.resolve(rootDir, manifestFile);
        const tempPath = `${manifestPath}.tmp`;
        await fs.writeFile(tempPath, encryptedManifest);
        await fs.rename(tempPath, manifestPath);
        
        log.info(`Military-Grade Lock applied. Manifest encrypted and signed containing ${sortedPaths.length} files.`);
    }

    public static async verify(
        rootDir: string, 
        signingPubKeyB64: string, 
        decryptionPrivKeyPem: string, 
        manifestFile = 'manifest.bin'
    ): Promise<boolean> {
        const manifestPath = path.resolve(rootDir, manifestFile);
        const rawEncryptedData = await fs.readFile(manifestPath).catch(() => {
            throw new IntegrityError('Manifest file not found. System integrity cannot be verified.');
        });

        const vault = new HybridVault(decryptionPrivKeyPem, undefined);
        const signedPayload = await vault.unpack<Buffer>(rawEncryptedData);

        if (signedPayload.length < 64) {
            throw new IntegrityError('Decrypted payload is too small to contain a signature.');
        }

        const signature = signedPayload.subarray(0, 64);
        const fbPayload = signedPayload.subarray(64);

        const publicKey = createPublicKey({ key: Buffer.from(signingPubKeyB64, 'base64'), format: 'der', type: 'spki' });
        const isAuthentic = verify(null, fbPayload, publicKey, signature);

        if (!isAuthentic) {
            throw new ManifestSignatureError('CRITICAL: Manifest signature is invalid. The manifest itself was forged or tampered with.');
        }

        const buf = new flatbuffers.ByteBuffer(fbPayload);
        const manifest = Manifest.getRootAsManifest(buf);
        
        const filesLength = manifest.filesLength();
        const scannedFiles = new Set<string>();
        const mismatches: string[] = [];
        const tasks: (() => Promise<void>)[] = [];

        const expectedFiles = new Map<string, { hash: Buffer; size: number }>();
        for (let i = 0; i < filesLength; i++) {
            const fileNode = manifest.files(i)!;
            const pathStr = fileNode.path();
            if (pathStr) {
                expectedFiles.set(pathStr, {
                    hash: Buffer.from(fileNode.hashArray()!),
                    size: fileNode.size()
                });
            }
        }

        for await (const { fullPath, relPath } of this.#discoverFiles(rootDir)) {
            scannedFiles.add(relPath);
            const expected = expectedFiles.get(relPath);

            if (!expected) {
                log.error(`[UNAUTHORIZED ADDITION] File detected: ${relPath}`);
                mismatches.push(relPath);
                continue;
            }

            tasks.push(async () => {
                const current = await this.calculateFileStats(fullPath);
                const currentHashBuf = Buffer.from(current.hash, 'hex');

                if (
                    current.size !== expected.size || 
                    expected.hash.length !== currentHashBuf.length || 
                    !timingSafeEqual(expected.hash, currentHashBuf)
                ) {
                    log.error(`[MODIFIED/CORRUPTED] Integrity breach: ${relPath}`);
                    mismatches.push(relPath);
                }
            });
        }

        await this.#runConcurrently(tasks);

        for (const expectedRelPath of expectedFiles.keys()) {
            if (!scannedFiles.has(expectedRelPath)) {
                log.error(`[DELETED] Required file missing: ${expectedRelPath}`);
                mismatches.push(expectedRelPath);
            }
        }

        fbPayload.fill(0);
        signature.fill(0);

        if (mismatches.length > 0) {
            throw new FileTamperingError(`Integrity check failed: ${mismatches.length} unauthorized alterations detected.`);
        }

        log.info('System integrity verified. Authentic, Encrypted, and Unmodified.');
        return true;
    }
}