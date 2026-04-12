import { generateKeyPairSync, diffieHellman, createPublicKey, createPrivateKey, KeyObject, randomBytes, hkdf } from 'node:crypto';
import { VaultConfigurationError, VaultFormatError } from './errors.js';
import { MAGIC_HYBRID } from './constants.js';
import { SecureVault } from './secureVault.js';

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