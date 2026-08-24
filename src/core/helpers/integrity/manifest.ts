import fs from 'node:fs/promises';
import path from 'node:path';
import { sign, verify, createPrivateKey, createPublicKey, timingSafeEqual } from 'node:crypto';
import * as flatbuffers from 'flatbuffers';
import { getLogger } from '#core/utils/logger.js';

import { NovaXManifest } from '#core/flatbuffer/nova-x/system/nova-xmanifest.js';
import { IntegrityPayload } from '#core/flatbuffer/nova-x/system/integrity-payload.js';
import { FileEntry } from '#core/flatbuffer/nova-x/system/file-entry.js';

import { IntegrityError, ManifestSignatureError, FileTamperingError, VaultMissingKeyError } from './errors.js';
import { HASH_ALGORITHM, SIGNATURE_LENGTH } from './constants.js';
import { IntegrityScanner } from './scanner.js';
import type { FileMetadata } from './types.js';
import type { PluginManifest } from '#core/bases/Plugin.js';

const log = getLogger('PackageManager');

const MAGIC_HEADER = Buffer.from('NCPLUG', 'utf8');
const HEADER_OFFSET = MAGIC_HEADER.length; 
const PAYLOAD_OFFSET = HEADER_OFFSET + SIGNATURE_LENGTH;

export class PackageManager {
    
    public static async pack(
        rootDir: string, 
        signingPrivKeyPem: string, 
        metadata: PluginManifest,
        outputFile = 'manifest.nvx'
    ): Promise<void> {
        const files: Record<string, FileMetadata> = {};
        const tasks: (() => Promise<void>)[] = [];

        for await (const { fullPath, relPath } of IntegrityScanner.discoverFiles(rootDir)) {
            if (relPath === outputFile || relPath === `${outputFile}.tmp`) continue;

            tasks.push(async () => {
                files[relPath] = await IntegrityScanner.calculateFileStats(fullPath);
            });
        }
        await IntegrityScanner.runConcurrently(tasks);

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

        const filesVecOffset = IntegrityPayload.createFilesVector(builder, fileOffsets);
        const algoOffset = builder.createString(HASH_ALGORITHM);

        IntegrityPayload.startIntegrityPayload(builder);
        IntegrityPayload.addTimestamp(builder, BigInt(Date.now()));
        IntegrityPayload.addAlgorithm(builder, algoOffset);
        IntegrityPayload.addFiles(builder, filesVecOffset);
        const integrityOffset = IntegrityPayload.endIntegrityPayload(builder);

        const idOffset = builder.createString(metadata.id);
        const nameOffset = builder.createString(metadata.name);
        const versionOffset = builder.createString(metadata.version);
        const descOffset = metadata.description ? builder.createString(metadata.description) : 0;
        const authorOffset = metadata.author ? builder.createString(metadata.author) : 0;
        const novaxVersionStr = Array.isArray(metadata.novax_version)
            ? metadata.novax_version.map(String).filter(Boolean).join(' ')
            : metadata.novax_version;
        const nvxVersionOffset = novaxVersionStr ? builder.createString(novaxVersionStr) : 0;
        const nodeVersionOffset = metadata.node_version ? builder.createString(metadata.node_version) : 0;

        let depsOffset = 0;
        if (metadata.dependencies && metadata.dependencies.length > 0) {
            const dOffsets = metadata.dependencies.map(d => builder.createString(d));
            depsOffset = NovaXManifest.createDependenciesVector(builder, dOffsets);
        }

        NovaXManifest.startNovaXManifest(builder);
        NovaXManifest.addId(builder, idOffset);
        NovaXManifest.addName(builder, nameOffset);
        NovaXManifest.addVersion(builder, versionOffset);
        if (descOffset) NovaXManifest.addDescription(builder, descOffset);
        if (authorOffset) NovaXManifest.addAuthor(builder, authorOffset);
        if (nvxVersionOffset) NovaXManifest.addNovaxVersion(builder, nvxVersionOffset);
        if (nodeVersionOffset) NovaXManifest.addNodeVersion(builder, nodeVersionOffset);
        if (depsOffset) NovaXManifest.addDependencies(builder, depsOffset);
        
        NovaXManifest.addIntegrity(builder, integrityOffset);
        builder.finish(NovaXManifest.endNovaXManifest(builder));

        const fbPayload = Buffer.from(builder.asUint8Array());

        let signKey;
        try {
            signKey = createPrivateKey(signingPrivKeyPem);
        } catch (err) {
            throw new IntegrityError('Invalid Private Key provided for packaging. Must be a valid PEM.');
        }
        
        const signature = sign(null, fbPayload, signKey);
        const finalBinaryFile = Buffer.concat([MAGIC_HEADER, signature, fbPayload]);

        const manifestPath = path.resolve(rootDir, outputFile);
        const tempPath = `${manifestPath}.tmp`;
        await fs.writeFile(tempPath, finalBinaryFile);
        await fs.rename(tempPath, manifestPath);
        
        log.info(`[${metadata.id}] Packaged perfectly. ${sortedPaths.length} files locked (Excluding dynamic data/).`);
    }

    public static async unpackAndVerify(
        rootDir: string, 
        signingPubKeyB64: string, 
        manifestFile = 'manifest.nvx'
    ): Promise<PluginManifest> {
        const manifestPath = path.resolve(rootDir, manifestFile);
        
        const fileBytes = await fs.readFile(manifestPath).catch(() => {
            throw new IntegrityError(`Required secure package [${manifestFile}] missing.`);
        });

        if (fileBytes.length < PAYLOAD_OFFSET) {
            throw new IntegrityError('File is too small to be a valid NovaX package.');
        }

        const magic = fileBytes.subarray(0, HEADER_OFFSET);
        const signature = fileBytes.subarray(HEADER_OFFSET, PAYLOAD_OFFSET);
        const fbPayload = fileBytes.subarray(PAYLOAD_OFFSET);

        if (!magic.equals(MAGIC_HEADER)) {
            throw new IntegrityError('Invalid magic header. This is not a NovaX package.');
        }

        let publicKey;
        try {
            publicKey = createPublicKey({ key: Buffer.from(signingPubKeyB64, 'base64'), format: 'der', type: 'spki' });
        } catch (err) {
            throw new VaultMissingKeyError('PluginPublicKey in Vault is malformed or invalid DER format.');
        }

        const isAuthentic = verify(null, fbPayload, publicKey, signature);

        if (!isAuthentic) {
            throw new ManifestSignatureError('CRITICAL: Package signature invalid. Metadata or code was tampered with.');
        }

        const buf = new flatbuffers.ByteBuffer(fbPayload);
        const manifest = NovaXManifest.getRootAsNovaXManifest(buf);
        const integrity = manifest.integrity();

        if (!integrity) {
            throw new IntegrityError('Package is missing the internal cryptographic integrity tree.');
        }

        const filesLength = integrity.filesLength();
        const scannedFiles = new Set<string>();
        const mismatches: string[] = [];
        const tasks: (() => Promise<void>)[] = [];
        const expectedFiles = new Map<string, { hash: Buffer; size: number }>();

        for (let i = 0; i < filesLength; i++) {
            const fileNode = integrity.files(i)!;
            const pathStr = fileNode.path();
            if (pathStr) {
                expectedFiles.set(pathStr, {
                    hash: Buffer.from(fileNode.hashArray()!),
                    size: fileNode.size()
                });
            }
        }

        for await (const { fullPath, relPath } of IntegrityScanner.discoverFiles(rootDir)) {
            if (relPath === manifestFile || relPath === `${manifestFile}.tmp`) continue;

            scannedFiles.add(relPath);
            const expected = expectedFiles.get(relPath);

            if (!expected) {
                mismatches.push(`[UNAUTHORIZED ADDITION] ${relPath}`);
                continue;
            }

            tasks.push(async () => {
                const current = await IntegrityScanner.calculateFileStats(fullPath);
                const currentHashBuf = Buffer.from(current.hash, 'hex');

                if (current.size !== expected.size || !timingSafeEqual(expected.hash, currentHashBuf)) {
                    mismatches.push(`[CORRUPTED/MODIFIED] ${relPath}`);
                }
            });
        }

        await IntegrityScanner.runConcurrently(tasks);

        for (const expectedRelPath of expectedFiles.keys()) {
            if (!scannedFiles.has(expectedRelPath)) mismatches.push(`[DELETED] ${expectedRelPath}`);
        }

        if (mismatches.length > 0) {
            mismatches.forEach(m => log.error(m));
            throw new FileTamperingError(`Package integrity check failed: ${mismatches.length} violations detected.`);
        }

        const dependencies: string[] = [];
        for (let i = 0; i < manifest.dependenciesLength(); i++) {
            dependencies.push(manifest.dependencies(i)!);
        }

        return {
            id: manifest.id()!,
            name: manifest.name()!,
            version: manifest.version()!,
            description: manifest.description() ?? undefined,
            author: manifest.author() ?? undefined,
            novax_version: manifest.novaxVersion() ?? undefined,
            node_version: manifest.nodeVersion() ?? undefined,
            dependencies: dependencies.length > 0 ? dependencies : undefined,
        };
    }
}