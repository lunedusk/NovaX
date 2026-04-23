import { BasePlugin, type PluginManifest } from '../../core/bases/Plugin.js';

export default class CryptoUtilsPlugin extends BasePlugin {
    public readonly manifest: PluginManifest = {
        id: 'crypto-utils',
        name: 'Crypto Utils',
        version: '0.1.0',
        author: 'NovaCore Development',
        novax_version: '>=0.1.0',
        node_version: '>=18.20.8',
        dependencies: ['core']
    };
    public async onSetup(): Promise<void> {

        try {
            let pool;
            try { pool = this.heart.db.postgres.get('crypto'); } 
            catch { pool = this.heart.db.postgres.get('main'); }

            await pool.query(`
                CREATE TABLE IF NOT EXISTS crypto_addresses (
                    id SERIAL PRIMARY KEY,
                    discord_id TEXT NOT NULL,
                    address TEXT NOT NULL,
                    coin TEXT,
                    label TEXT,
                    networks JSONB,
                    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            this.log.info('Crypto Database verified.');
        } catch (e: any) {
            this.log.error('Failed to initialize Crypto Database:', e);
        }
        
    }

    public async onEnable(): Promise<void> {
        
    }

    public async onDisable(): Promise<void> {
        
    }
}