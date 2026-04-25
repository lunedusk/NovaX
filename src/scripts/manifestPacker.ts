import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

if (!process.env.NODE_ENV || process.env.NODE_ENV.trim() === '') {
    process.env.NODE_ENV = 'production';
}
if (!process.env.PublicKey || process.env.PublicKey.trim() === '') {
    process.env.PublicKey = 'MCowBQYDK2VwAyEAxGjGVv/sK86Px3N7hLY1x1QxS5bugvrqPlo8MW95BwQ=';
}

import { secrets } from '#core/helpers/secretManager.js';
import { getLogger, flushLogs } from '#core/utils/logger.js';
import { PackageManager } from '#core/helpers/integrity/manifest.js';
import type { PluginManifest } from '#core/bases/Plugin.js';

class BinaryManifestPacker {
    private readonly log;
    private readonly privateKeyPem: string;

    constructor() {
        this.log = getLogger('BinaryPacker');
        
        let privKey = secrets.getOptional('PrivateKey') || process.env.PrivateKey;

        if (!privKey) {
            this.log.error('Missing cryptographic key! Ensure PrivateKey is set in your .env file.');
            process.exit(1);
        }

        if (!privKey.includes('BEGIN PRIVATE KEY')) {
            const formattedKey = privKey.match(/.{1,64}/g)?.join('\n');
            privKey = `-----BEGIN PRIVATE KEY-----\n${formattedKey}\n-----END PRIVATE KEY-----`;
        }

        this.privateKeyPem = privKey;
        this.log.info('Cryptographic engine initialized with Ed25519 PEM Key.');
    }

    public async pack(pluginId: string): Promise<void> {
        if (!pluginId) {
            this.log.error('No plugin specified. Usage: npm run pack <plugin_id>');
            process.exit(1);
        }

        const pluginDir = path.resolve(process.cwd(), 'plugins', pluginId);
        const sourceManifestPath = path.join(pluginDir, 'manifest.json');

        try {
            const dirStat = await fs.stat(pluginDir).catch(() => null);
            if (!dirStat || !dirStat.isDirectory()) {
                throw new Error(`Plugin directory not found: ${pluginDir}`);
            }

            this.log.info(`Reading source metadata for plugin: [${pluginId}]`);
            const rawData = await fs.readFile(sourceManifestPath, 'utf-8');
            const metadata: PluginManifest = JSON.parse(rawData);

            if (!metadata.id || !metadata.name || !metadata.version) {
                throw new Error(`Invalid manifest.json. Missing required fields (id, name, version).`);
            }

            this.log.info(`Generating Flatbuffer and calculating file hashes...`);
            
            await PackageManager.pack(
                pluginDir, 
                this.privateKeyPem, 
                metadata, 
                'manifest.nvx'
            );

            this.log.info('--------------------------------------------------');
            this.log.info(`Successfully locked and signed: ${pluginId}`);
            this.log.info(`Output: plugins/${pluginId}/manifest.nvx`);
            this.log.info('--------------------------------------------------');

        } catch (error: any) {
            if (error.code === 'ENOENT') {
                this.log.error(`Source manifest.json not found at: ${sourceManifestPath}`);
                this.log.error(`You must have a basic manifest.json to generate the .nvx file.`);
            } else if (error instanceof SyntaxError) {
                this.log.error(`Invalid JSON format in manifest.json for ${pluginId}.`);
            } else {
                this.log.error(`Packaging failed: ${error.message}`);
                if (error.stack) this.log.debug(error.stack);
            }
            process.exit(1);
        }
    }
}

async function main() {
    try {
        secrets.assimilateEnv();
        
        const logger = getLogger('Bootstrap');
        logger.info('Starting NovaX Binary Manifest Packer...');
        
        const args = process.argv.slice(2);
        const pluginId = args[0];

        const packer = new BinaryManifestPacker();
        await packer.pack(pluginId);
        
    } catch (error) {
        console.error('FATAL APPLICATION CRASH:', error);
        process.exit(1);
    } finally {
        await flushLogs();
    }
}

main();