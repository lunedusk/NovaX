import { BaseHandler } from '#core/bases/Handler.js';
import { secrets } from '#core/helpers/secretManager.js';
import { sqliteDB } from '#core/database/sqlite.js';
import {
    TokenManager,
    SqliteTokenStore,
    TokenError,
    BitSets,
    extractBearer,
    extractCookie,
    type VerifiedToken,
    type TokenIssueOptions,
    type TokenRefreshOptions,
    type DeviceTokenMeta,
    type Bit,
} from '#core/manager/token.js';
import { permissionsManager } from '#core/manager/permissions.js';

export default class TokenHandler extends BaseHandler {

    public readonly name = 'manager';
    public readonly version = '1.0.0';
    public readonly description = 'Token issuance, verification, refresh, and revocation API.';

    private tokenManager!: TokenManager;

    public async onInitialize(): Promise<void> {
        const masterSecret = secrets.getOptional('TokenMasterSecret', '');
        if (!masterSecret || masterSecret.length < 32) {
            throw new Error('TokenMasterSecret must be at least 32 characters. Set it in your .env file.');
        }

        const db = sqliteDB.get('main');
        const store = new SqliteTokenStore(db as any);

        this.tokenManager = new TokenManager(masterSecret, store, {
            ttlSeconds: parseInt(secrets.getOptional('TokenTTL', '900') ?? '900'),
            maxTtlSeconds: parseInt(secrets.getOptional('TokenMaxTTL', '86400') ?? '86400'),
            issuer: secrets.getOptional('TokenIssuer', 'novax') ?? 'novax',
            audience: secrets.getOptional('TokenAudience', 'dashboard') ?? 'dashboard',
            onAudit: (event) => { this.log.debug(`Token audit: ${event.type} userId=${event.userId ?? '-'}`); },
        });

        this.log.info('Token handler ready.');
    }


    public async onTeardown(): Promise<void> {
        this.log.info('Token handler torn down.');
    }

    public getTokenManager(): TokenManager {
        return this.tokenManager;
    }

    public async issue(userId: string, options?: TokenIssueOptions): Promise<string> {
        return this.tokenManager.issue(userId, options);
    }

    public async issueWithResolvedBits(userId: string, guildId?: string, options?: Omit<TokenIssueOptions, 'bits'>): Promise<string> {
        const resolved = await permissionsManager!.cachedResolve(userId, guildId);
        const bits = [...resolved.bits];
        return this.tokenManager.issue(userId, { ...options, bits, guildId });
    }

    public async verify(token: string): Promise<VerifiedToken> {
        return this.tokenManager.verify(token);
    }

    public async refresh(token: string, options?: TokenRefreshOptions): Promise<string> {
        return this.tokenManager.refresh(token, options);
    }

    public async refreshWithResolvedBits(token: string): Promise<string> {
        return this.tokenManager.refresh(token, {
            getBits: async (userId: string, guildId?: string) => {
                const resolved = await permissionsManager!.cachedResolve(userId, guildId);
                return [...resolved.bits];
            },
        });
    }

    public async revokeAll(userId: string): Promise<number> {
        return this.tokenManager.revokeAll(userId);
    }

    public async revokeDevice(userId: string, deviceId: string, guildId?: string): Promise<number> {
        return this.tokenManager.revokeDevice(userId, deviceId, guildId);
    }

    public async listDevices(userId: string): Promise<DeviceTokenMeta[]> {
        return this.tokenManager.listDevices(userId);
    }

    public hasBit(verified: VerifiedToken, bit: Bit): boolean {
        return this.tokenManager.hasBit(verified, bit);
    }

    public requireBit(verified: VerifiedToken, bit: Bit): void {
        return this.tokenManager.requireBit(verified, bit);
    }

    public async extractBearer(authHeader: string | null | undefined): Promise<VerifiedToken> {
        return extractBearer(authHeader, this.tokenManager);
    }

    public async extractCookie(cookieHeader: string | null | undefined, cookieName?: string): Promise<VerifiedToken> {
        return extractCookie(cookieHeader, this.tokenManager, cookieName);
    }

    public getBitSets() {
        return BitSets;
    }
}

export { TokenError, BitSets, type VerifiedToken, type TokenIssueOptions, type DeviceTokenMeta, type Bit };
