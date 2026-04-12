import fs from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('IntegrityCrypto');

export class IntegrityCrypto {
    public static async generateSignatureKeys(privateKeyPath: string): Promise<string> {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        await fs.mkdir(path.dirname(privateKeyPath), { recursive: true });
        
        await fs.writeFile(privateKeyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }), 'utf-8');
    
        log.info('Ed25519 Integrity Keys generated successfully.');
        return Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).toString('base64');
    }
}