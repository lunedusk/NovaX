import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
    scrypt,
    hkdf,
    generateKeyPairSync,
    diffieHellman,
    createPublicKey,
    createPrivateKey,
    KeyObject,
    CipherGCM,
    DecipherGCM
} from 'node:crypto';
import { brotliCompress, brotliDecompress, BrotliOptions, constants as zlibConstants } from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';

const scryptAsync = (password: any, salt: any, keylen: number, options: any): Promise<Buffer> =>
    new Promise((resolve, reject) => scrypt(password, salt, keylen, options, (err, key) => err ? reject(err) : resolve(Buffer.from(key))));

const compressAsync = (buffer: any, options: BrotliOptions): Promise<Buffer> =>
    new Promise((resolve, reject) => brotliCompress(buffer, options, (err, result) => err ? reject(err) : resolve(Buffer.from(result))));

const decompressAsync = (buffer: any): Promise<Buffer> =>
    new Promise((resolve, reject) => brotliDecompress(buffer, (err, result) => err ? reject(err) : resolve(Buffer.from(result))));

export class VaultError extends Error { constructor(msg: string) { super(msg); this.name = this.constructor.name; } }
export class VaultFormatError extends VaultError {}
export class VaultIntegrityError extends VaultError {}
export class VaultConfigurationError extends VaultError {}

const MAGIC_HEADER = Buffer.from('NCDEV');
const MAGIC_HYBRID = Buffer.from('NCHYB');
const FORMAT_VERSION = 1;
const FLAG_COMPRESSED = 0b00000001;
const MAX_SERIALIZER_NAME = 64;
const DEFAULT_CHUNK_SIZE = 64 * 1024;

export interface Serializer<T = any> {
    name: string;
    encode(obj: T): Buffer;
    decode(raw: Buffer): T;
    retainsBufferReference?: boolean;
    isVolatile?: boolean;
}

export const Serializers = {
    json: {
        name: 'json',
        encode: (obj: any) => Buffer.from(JSON.stringify(obj), 'utf-8'),
        decode: (raw: Buffer) => JSON.parse(raw.toString('utf-8')),
        retainsBufferReference: false,
        isVolatile: true 
    } as Serializer<any>,
    text: {
        name: 'text',
        encode: (obj: string) => Buffer.from(obj, 'utf-8'),
        decode: (raw: Buffer) => raw.toString('utf-8'),
        retainsBufferReference: false,
        isVolatile: true
    } as Serializer<string>,
    bytes: {
        name: 'bytes',
        encode: (obj: Buffer) => obj,
        decode: (raw: Buffer) => Buffer.from(raw), 
        retainsBufferReference: false,
        isVolatile: false 
    } as Serializer<Buffer>
};

export function createFlatBufferSerializer<T>(
    name: string,
    encodeFn: (obj: T) => Uint8Array,
    decodeFn: (bytes: Uint8Array) => T
): Serializer<T> {
    if (!name || Buffer.byteLength(name) > MAX_SERIALIZER_NAME) {
        throw new VaultConfigurationError(`Invalid FlatBuffer serializer name: ${name}`);
    }
    
    return {
        name,
        encode: (obj: T) => Buffer.from(encodeFn(obj).buffer as ArrayBuffer, encodeFn(obj).byteOffset, encodeFn(obj).byteLength),
        decode: (raw: Buffer) => decodeFn(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)),
        retainsBufferReference: true,
        isVolatile: false 
    };
}

export interface VaultOptions {
    compress?: boolean;
    chunkSize?: number;
    extension?: string;
}

export class SecureVault {
    readonly #masterSecret: Buffer;
    readonly #mode: 'hkdf' | 'scrypt';
    readonly #options: Required<VaultOptions>;
    readonly #serializers = new Map<string, Serializer>();
    #isDestroyed = false;

    private constructor(masterSecret: Buffer, mode: 'hkdf' | 'scrypt', options?: VaultOptions) {
        this.#masterSecret = masterSecret;
        this.#mode = mode;
        this.#options = {
            compress: options?.compress ?? true,
            chunkSize: options?.chunkSize ?? DEFAULT_CHUNK_SIZE,
            extension: options?.extension ?? '.nc'
        };

        this.registerSerializer(Serializers.json);
        this.registerSerializer(Serializers.text);
        this.registerSerializer(Serializers.bytes);
    }

    public static fromKey(key: Buffer, options?: VaultOptions): SecureVault {
        if (key.length === 0) throw new VaultConfigurationError('Key cannot be empty');
        return new SecureVault(key, 'hkdf', options);
    }

    public static fromPassword(password: string, options?: VaultOptions): SecureVault {
        if (!password) throw new VaultConfigurationError('Password cannot be empty');
        return new SecureVault(Buffer.from(password, 'utf-8'), 'scrypt', options);
    }

    public destroy(): void {
        if (this.#isDestroyed) return;
        this.#masterSecret.fill(0);
        this.#isDestroyed = true;
    }

    private ensureNotDestroyed(): void {
        if (this.#isDestroyed) throw new VaultError('Attempted to use a destroyed Vault instance.');
    }

    public registerSerializer(serializer: Serializer): void {
        if (Buffer.byteLength(serializer.name) > MAX_SERIALIZER_NAME) {
            throw new VaultConfigurationError(`Serializer name exceeds ${MAX_SERIALIZER_NAME} bytes`);
        }
        this.#serializers.set(serializer.name, serializer);
    }

    async #deriveKey(salt: Buffer): Promise<Buffer> {
        this.ensureNotDestroyed();
        if (this.#mode === 'hkdf') {
            return new Promise((resolve, reject) => {
                hkdf('sha256', this.#masterSecret, salt, 'Enclave/ChaCha20Poly1305/v4', 32, (err, key) => {
                    if (err) reject(err);
                    else resolve(Buffer.from(key));
                });
            });
        } else {
            return await scryptAsync(this.#masterSecret, salt, 32, { N: 2 ** 14, r: 8, p: 1 });
        }
    }

    #getNonce(chunkIdx: number): Buffer {
        const nonce = Buffer.allocUnsafe(12);
        nonce.writeBigUInt64BE(BigInt(chunkIdx), 0);
        nonce.writeUInt32BE(0, 8);
        return nonce;
    }

    public async pack<T>(obj: T, serializerName = 'json', compress?: boolean): Promise<Buffer> {
        this.ensureNotDestroyed();
        const serializer = this.#serializers.get(serializerName);
        if (!serializer) throw new VaultError(`Unknown serializer: ${serializerName}`);

        const shouldCompress = compress ?? this.#options.compress;
        const rawPayload = serializer.encode(obj);

        const salt = randomBytes(16);
        const flags = shouldCompress ? FLAG_COMPRESSED : 0;
        const serNameBuf = Buffer.from(serializer.name, 'utf-8');

        const header = Buffer.concat([
            MAGIC_HEADER,
            Buffer.from([FORMAT_VERSION]),
            salt,
            Buffer.from([flags, serNameBuf.length]),
            serNameBuf
        ]);

        const key = await this.#deriveKey(salt);
        const outChunks: Buffer[] = [header];

        const aad = Buffer.allocUnsafe(header.length + 4);
        header.copy(aad, 0);

        let chunkIdx = 0;
        for (let i = 0; i < rawPayload.length; i += this.#options.chunkSize) {
            let chunk = rawPayload.subarray(i, i + this.#options.chunkSize);
            
            if (shouldCompress) {
                chunk = await compressAsync(chunk, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } });
            }

            const nonce = this.#getNonce(chunkIdx);
            aad.writeUInt32BE(chunkIdx, header.length); 

            const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 }) as CipherGCM;
            cipher.setAAD(aad);

            const ciphertext = Buffer.concat([cipher.update(chunk), cipher.final(), cipher.getAuthTag()]);

            const sizeBuf = Buffer.allocUnsafe(4);
            sizeBuf.writeUInt32BE(ciphertext.length, 0);

            outChunks.push(sizeBuf, nonce, ciphertext);
            chunkIdx++;
        }

        if (serializer.isVolatile) {
            rawPayload.fill(0);
        }
        key.fill(0);
        
        return Buffer.concat(outChunks);
    }

    public async unpack<T = any>(blob: Buffer): Promise<T> {
        this.ensureNotDestroyed();
        if (blob.length < MAGIC_HEADER.length + 18) throw new VaultFormatError('Blob too short');
        
        let offset = 0;
        const magic = blob.subarray(offset, offset += MAGIC_HEADER.length);
        if (!magic.equals(MAGIC_HEADER)) throw new VaultFormatError('Invalid Magic Header');

        const version = blob.readUInt8(offset++);
        if (version !== FORMAT_VERSION) throw new VaultFormatError('Unsupported Format Version');

        const salt = blob.subarray(offset, offset += 16);
        const flags = blob.readUInt8(offset++);
        const isCompressed = (flags & FLAG_COMPRESSED) !== 0;

        const serLen = blob.readUInt8(offset++);
        const serName = blob.subarray(offset, offset += serLen).toString('utf-8');
        
        const headerBytes = blob.subarray(0, offset);
        const key = await this.#deriveKey(salt);
        const serializer = this.#serializers.get(serName);

        if (!serializer) throw new VaultError(`Unknown embedded serializer: ${serName}`);

        const decryptedChunks: Buffer[] = [];
        const aad = Buffer.allocUnsafe(headerBytes.length + 4);
        headerBytes.copy(aad, 0);

        let chunkIdx = 0;

        while (offset < blob.length) {
            if (offset + 4 > blob.length) throw new VaultFormatError('Truncated chunk size');
            const encSize = blob.readUInt32BE(offset);
            offset += 4;

            if (offset + 12 > blob.length) throw new VaultFormatError('Truncated nonce');
            const nonce = blob.subarray(offset, offset += 12);
            
            if (!nonce.equals(this.#getNonce(chunkIdx))) {
                throw new VaultIntegrityError(`Unexpected nonce at chunk ${chunkIdx}. File tampered.`);
            }

            if (offset + encSize > blob.length) throw new VaultFormatError('Truncated ciphertext');
            const encryptedChunk = blob.subarray(offset, offset += encSize);

            const ciphertext = encryptedChunk.subarray(0, -16);
            const authTag = encryptedChunk.subarray(-16);

            aad.writeUInt32BE(chunkIdx, headerBytes.length);

            try {
                const decipher = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 }) as DecipherGCM;
                decipher.setAAD(aad);
                decipher.setAuthTag(authTag);
                
                let plainChunk: any = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
                
                if (isCompressed) {
                    plainChunk = await decompressAsync(plainChunk);
                }
                
                decryptedChunks.push(plainChunk);
            } catch (err) {
                throw new VaultIntegrityError(`AEAD Authentication failed for chunk ${chunkIdx}.`);
            }
            chunkIdx++;
        }

        const fullRaw = Buffer.concat(decryptedChunks);
        const result = serializer.decode(fullRaw);

        decryptedChunks.forEach(c => c.fill(0));
        key.fill(0);

        if (!serializer.retainsBufferReference) {
            fullRaw.fill(0);
        }

        return result as T;
    }

    public async packToFile(filepath: string, obj: any, serializerName = 'json'): Promise<void> {
        const payload = await this.pack(obj, serializerName);
        const dir = path.dirname(filepath);
        await fs.mkdir(dir, { recursive: true });
        
        const tempPath = `${filepath}.tmp`;
        await fs.writeFile(tempPath, payload);
        await fs.rename(tempPath, filepath);
    }

    public async unpackFromFile<T = any>(filepath: string): Promise<T> {
        const blob = await fs.readFile(filepath);
        return await this.unpack<T>(blob);
    }
}

export class HybridVault {
    readonly #serverPriv?: KeyObject;
    readonly #serverPub: KeyObject;
    readonly #serverPubDer: Buffer;

    constructor(privateKeyPem?: string, publicKeyPem?: string) {
        if (!privateKeyPem && !publicKeyPem) throw new VaultConfigurationError('Requires at least one key');
        
        if (privateKeyPem) this.#serverPriv = createPrivateKey(privateKeyPem);
        this.#serverPub = publicKeyPem ? createPublicKey(publicKeyPem) : createPublicKey(this.#serverPriv!);
        this.#serverPubDer = this.#serverPub.export({ type: 'spki', format: 'der' }) as Buffer;
    }

    public static generateKeys(): { privateKey: string, publicKey: string } {
        const { privateKey, publicKey } = generateKeyPairSync('x25519');
        return {
            privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
            publicKey: publicKey.export({ type: 'spki', format: 'pem' }) as string
        };
    }

    public async pack(obj: any, serializerName = 'json'): Promise<Buffer> {
        if (!this.#serverPub) throw new VaultConfigurationError('Public key required to pack data');

        const { privateKey: ephPriv, publicKey: ephPub } = generateKeyPairSync('x25519');
        const ephPubDer = ephPub.export({ type: 'spki', format: 'der' }) as Buffer;

        const sharedSecret = diffieHellman({ privateKey: ephPriv, publicKey: this.#serverPub });
        const salt = randomBytes(16);

        const kdfInfo = Buffer.concat([Buffer.from('HybridVault'), ephPubDer, this.#serverPubDer]);
        
        const masterSecret = await new Promise<Buffer>((resolve, reject) => {
            hkdf('sha256', sharedSecret, salt, kdfInfo, 32, (err, key) => err ? reject(err) : resolve(Buffer.from(key)));
        });

        sharedSecret.fill(0); 

        const vault = SecureVault.fromKey(masterSecret);
        const encryptedBlob = await vault.pack(obj, serializerName);

        vault.destroy();
        masterSecret.fill(0);

        return Buffer.concat([MAGIC_HYBRID, salt, ephPubDer, encryptedBlob]);
    }

    public async unpack<T = any>(blob: Buffer): Promise<T> {
        if (!this.#serverPriv) throw new VaultConfigurationError('Private key required to unpack data');

        let offset = 0;
        const magic = blob.subarray(offset, offset += MAGIC_HYBRID.length);
        if (!magic.equals(MAGIC_HYBRID)) throw new VaultFormatError('Invalid Hybrid Magic Header');

        const salt = blob.subarray(offset, offset += 16);
        
        const ephPubDer = blob.subarray(offset, offset += 44); 
        const ephPub = createPublicKey({ key: ephPubDer, type: 'spki', format: 'der' });

        const vaultBlob = blob.subarray(offset);

        const sharedSecret = diffieHellman({ privateKey: this.#serverPriv, publicKey: ephPub });
        const kdfInfo = Buffer.concat([Buffer.from('HybridVault'), ephPubDer, this.#serverPubDer]);
        
        const masterSecret = await new Promise<Buffer>((resolve, reject) => {
            hkdf('sha256', sharedSecret, salt, kdfInfo, 32, (err, key) => err ? reject(err) : resolve(Buffer.from(key)));
        });

        sharedSecret.fill(0); 

        const vault = SecureVault.fromKey(masterSecret);
        const result = await vault.unpack<T>(vaultBlob);

        vault.destroy();
        masterSecret.fill(0);

        return result;
    }
}