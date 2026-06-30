import { createHmac, timingSafeEqual, randomBytes } from "crypto";

export type Bit = string;

export const BitSets = {
  SERVER_READONLY: ["server.config.view", "server.members.view"] as Bit[],
  SERVER_MANAGER: [
    "server.config.view",
    "server.config.manage",
    "server.members.view",
    "server.members.kick",
    "server.members.ban",
    "server.members.mute",
    "server.members.history",
    "server.members.notes",
    "server.roles.manage",
    "server.lang.manage",
    "server.logs.view",
    "server.analytics.view",
  ] as Bit[],
  BOT_READONLY: ["bot.servers.view", "bot.plugins.view", "bot.logs.view"] as Bit[],
  BOT_ADMIN: [
    "bot.servers.view",
    "bot.servers.manage",
    "bot.servers.ban",
    "bot.members.view",
    "bot.members.kick",
    "bot.members.ban",
    "bot.members.mute",
    "bot.members.ban_global",
    "bot.plugins.view",
    "bot.plugins.manage",
    "bot.plugins.reload",
    "bot.roles.manage",
    "bot.theme.manage",
    "bot.dash.pages.manage",
    "bot.logs.view",
    "bot.analytics.view",
  ] as Bit[],
} as const;


export interface TokenPayload {
  userId: string;
  iat: number;
  exp: number;
  jti: string;
  deviceId: string;
  deviceLabel?: string;
  bits: Bit[];
  guildId?: string;
  tokenVersion: string;
  iss: string;
  aud: string;
}

export interface VerifiedToken {
  payload: TokenPayload;
  raw: string;
}

export interface TokenIssueOptions {
  bits?: Bit[];
  guildId?: string;
  deviceId?: string;
  deviceLabel?: string;
  ttlSeconds?: number;
  useDeviceVersion?: boolean;
}

export interface TokenRefreshOptions {
  getBits?: (userId: string, guildId?: string) => Promise<Bit[]>;
}

export type AuditEventType =
  | "token.issued"
  | "token.verified"
  | "token.refreshed"
  | "token.revoked_device"
  | "token.revoked_all"
  | "token.verify_failed"
  | "token.expired"
  | "token.rotation_attack";

export interface AuditEvent {
  type: AuditEventType;
  userId?: string;
  deviceId?: string;
  guildId?: string;
  jti?: string;
  reason?: string;
  timestamp: number;
}

export type AuditHandler = (event: AuditEvent) => void | Promise<void>;

export interface TokenManagerOptions {
  ttlSeconds?: number;
  maxTtlSeconds?: number;
  issuer?: string;
  audience?: string;
  bitAllowlist?: ReadonlySet<Bit>;
  onAudit?: AuditHandler;
  onVerifyFailure?: (error: TokenError) => void | Promise<void>;
}

export interface DeviceTokenMeta {
  _id: string;
  userId: string;
  deviceId: string;
  guildId?: string;
  tokenVersion: number;
  deviceLabel?: string;
  issuedAt: number;
  lastSeenAt: number;
  lastJti?: string;
}

export interface TokenStore {
  getGlobalVersion(userId: string): Promise<number>;
  incrementGlobalVersion(userId: string): Promise<number>;
  getDeviceVersion(userId: string, deviceId: string, guildId?: string): Promise<number>;
  incrementDeviceVersion(userId: string, deviceId: string, guildId?: string): Promise<number>;
  upsertDevice(
    userId: string,
    deviceId: string,
    meta: Partial<Omit<DeviceTokenMeta, "_id" | "userId" | "deviceId" | "guildId">>,
    guildId?: string
  ): Promise<void>;
  listDevices(userId: string): Promise<DeviceTokenMeta[]>;
  deleteDevice(userId: string, deviceId: string, guildId?: string): Promise<void>;
  getLastJti(userId: string, deviceId: string, guildId?: string): Promise<string | undefined>;
}

interface SqliteDb {
  prepare(sql: string): {
    run: (...params: unknown[]) => unknown;
    get: (...params: unknown[]) => any;
    all: (...params: unknown[]) => any[];
  };
  exec(sql: string): void;
}

export class SqliteTokenStore implements TokenStore {
  constructor(private readonly db: SqliteDb) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS token_global (
        id           TEXT PRIMARY KEY,
        tokenVersion INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS token_devices (
        id           TEXT PRIMARY KEY,
        userId       TEXT NOT NULL,
        deviceId     TEXT NOT NULL,
        guildId      TEXT,
        tokenVersion INTEGER NOT NULL DEFAULT 0,
        deviceLabel  TEXT,
        issuedAt     INTEGER NOT NULL,
        lastSeenAt   INTEGER NOT NULL,
        lastJti      TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_token_devices_user ON token_devices(userId);
    `);
  }

  private deviceKey(userId: string, deviceId: string, guildId?: string): string {
    return guildId
      ? `device:${guildId}:${userId}:${deviceId}`
      : `device:${userId}:${deviceId}`;
  }

  async getGlobalVersion(userId: string): Promise<number> {
    const row = this.db.prepare(`SELECT tokenVersion FROM token_global WHERE id = ?`).get(`global:${userId}`);
    return row?.tokenVersion ?? 0;
  }

  async incrementGlobalVersion(userId: string): Promise<number> {
    const id = `global:${userId}`;
    this.db.prepare(`
      INSERT INTO token_global (id, tokenVersion) VALUES (?, 1)
      ON CONFLICT(id) DO UPDATE SET tokenVersion = tokenVersion + 1
    `).run(id);
    const row = this.db.prepare(`SELECT tokenVersion FROM token_global WHERE id = ?`).get(id);
    return row.tokenVersion;
  }

  async getDeviceVersion(userId: string, deviceId: string, guildId?: string): Promise<number> {
    const row = this.db.prepare(`SELECT tokenVersion FROM token_devices WHERE id = ?`)
      .get(this.deviceKey(userId, deviceId, guildId));
    return row?.tokenVersion ?? 0;
  }

  async incrementDeviceVersion(userId: string, deviceId: string, guildId?: string): Promise<number> {
    const id = this.deviceKey(userId, deviceId, guildId);
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      INSERT INTO token_devices (id, userId, deviceId, guildId, tokenVersion, issuedAt, lastSeenAt)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET tokenVersion = tokenVersion + 1
    `).run(id, userId, deviceId, guildId ?? null, now, now);
    const row = this.db.prepare(`SELECT tokenVersion FROM token_devices WHERE id = ?`).get(id);
    return row.tokenVersion;
  }

  async upsertDevice(
    userId: string,
    deviceId: string,
    meta: Partial<Omit<DeviceTokenMeta, "_id" | "userId" | "deviceId" | "guildId">>,
    guildId?: string
  ): Promise<void> {
    const id = this.deviceKey(userId, deviceId, guildId);
    const now = Math.floor(Date.now() / 1000);
    const existing = this.db.prepare(`SELECT * FROM token_devices WHERE id = ?`).get(id);

    const merged = {
      tokenVersion: meta.tokenVersion ?? existing?.tokenVersion ?? 0,
      deviceLabel: meta.deviceLabel ?? existing?.deviceLabel ?? null,
      issuedAt: existing?.issuedAt ?? meta.issuedAt ?? now,
      lastSeenAt: meta.lastSeenAt ?? now,
      lastJti: meta.lastJti ?? existing?.lastJti ?? null,
    };

    this.db.prepare(`
      INSERT INTO token_devices (id, userId, deviceId, guildId, tokenVersion, deviceLabel, issuedAt, lastSeenAt, lastJti)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        tokenVersion = excluded.tokenVersion,
        deviceLabel  = excluded.deviceLabel,
        lastSeenAt   = excluded.lastSeenAt,
        lastJti      = excluded.lastJti
    `).run(id, userId, deviceId, guildId ?? null, merged.tokenVersion, merged.deviceLabel, merged.issuedAt, merged.lastSeenAt, merged.lastJti);
  }

  async listDevices(userId: string): Promise<DeviceTokenMeta[]> {
    const rows = this.db.prepare(`SELECT * FROM token_devices WHERE userId = ?`).all(userId);
    return rows.map((r: any) => ({
      _id: r.id,
      userId: r.userId,
      deviceId: r.deviceId,
      guildId: r.guildId ?? undefined,
      tokenVersion: r.tokenVersion,
      deviceLabel: r.deviceLabel ?? undefined,
      issuedAt: r.issuedAt,
      lastSeenAt: r.lastSeenAt,
      lastJti: r.lastJti ?? undefined,
    }));
  }

  async deleteDevice(userId: string, deviceId: string, guildId?: string): Promise<void> {
    this.db.prepare(`DELETE FROM token_devices WHERE id = ?`).run(this.deviceKey(userId, deviceId, guildId));
  }

  async getLastJti(userId: string, deviceId: string, guildId?: string): Promise<string | undefined> {
    const row = this.db.prepare(`SELECT lastJti FROM token_devices WHERE id = ?`)
      .get(this.deviceKey(userId, deviceId, guildId));
    return row?.lastJti ?? undefined;
  }
}

function b64Encode(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64url");
}

function b64Decode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf-8");
}

function sign(data: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function packVersion(globalVersion: number, deviceVersion: number): string {
  return `${globalVersion}:${deviceVersion}`;
}

const SAFE_EQUAL_MIN_PAD = 64;

function safeEqual(a: string, b: string): boolean {
  const padLen = Math.max(a.length, b.length, SAFE_EQUAL_MIN_PAD);
  const bufA = Buffer.from(a.padEnd(padLen, "\x00"), "utf-8");
  const bufB = Buffer.from(b.padEnd(padLen, "\x00"), "utf-8");
  return timingSafeEqual(bufA, bufB) && a.length === b.length;
}

export class TokenManager {
  private readonly masterKeyBuf: Buffer;
  private readonly store: TokenStore;
  private readonly ttlSeconds: number;
  private readonly maxTtlSeconds: number;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly bitAllowlist: ReadonlySet<Bit> | undefined;
  private readonly onAudit: AuditHandler | undefined;
  private readonly onVerifyFailure: ((e: TokenError) => void | Promise<void>) | undefined;

  constructor(masterSecret: string, store: TokenStore, options: TokenManagerOptions = {}) {
    if (!masterSecret || masterSecret.length < 32) {
      throw new Error("MASTER_SECRET must be at least 32 characters");
    }
    this.masterKeyBuf = createHmac("sha256", "token-manager-v2")
      .update(masterSecret)
      .digest();

    this.store           = store;
    this.ttlSeconds       = options.ttlSeconds    ?? 900;
    this.maxTtlSeconds    = options.maxTtlSeconds ?? 86_400;
    this.issuer           = options.issuer         ?? "token-manager";
    this.audience         = options.audience       ?? "default";
    this.bitAllowlist     = options.bitAllowlist;
    this.onAudit          = options.onAudit;
    this.onVerifyFailure  = options.onVerifyFailure;
  }

  private signingKey(userId: string, tokenVersion: string): Buffer {
    return createHmac("sha256", this.masterKeyBuf)
      .update(`${userId}:${tokenVersion}`)
      .digest();
  }

  private async emit(event: AuditEvent): Promise<void> {
    if (!this.onAudit) return;
    try {
      await this.onAudit(event);
    } catch {
    }
  }

  private validateBits(bits: Bit[]): void {
    if (!this.bitAllowlist) return;
    for (const b of bits) {
      if (!this.bitAllowlist.has(b)) {
        throw new TokenError("INVALID_PERMISSION", `Bit "${b}" is not in the allowlist`);
      }
    }
  }

  async issue(userId: string, options: TokenIssueOptions = {}): Promise<string> {
    validateSnowflake(userId);

    const bits = options.bits ?? [];
    this.validateBits(bits);

    const ttl = Math.min(options.ttlSeconds ?? this.ttlSeconds, this.maxTtlSeconds);

    const deviceId = options.deviceId ?? randomBytes(16).toString("hex");
    const jti      = randomBytes(16).toString("hex");
    const now      = Math.floor(Date.now() / 1000);
    const guildId  = options.guildId;

    const globalVersion = await this.store.getGlobalVersion(userId);
    const deviceVersion = options.useDeviceVersion
      ? await this.store.getDeviceVersion(userId, deviceId, guildId)
      : 0;
    const tokenVersion = packVersion(globalVersion, deviceVersion);

    const payload: TokenPayload = {
      userId,
      iat: now,
      exp: now + ttl,
      jti,
      deviceId,
      ...(options.deviceLabel && { deviceLabel: options.deviceLabel }),
      bits,
      ...(guildId && { guildId }),
      tokenVersion,
      iss: this.issuer,
      aud: this.audience,
    };

    const userPart    = b64Encode(userId);
    const payloadPart = b64Encode(JSON.stringify(payload));
    const body        = `R${userPart}_${payloadPart}`;
    const key         = this.signingKey(userId, tokenVersion);
    const signature   = sign(body, key);
    const token       = `${body}.${signature}`;

    await this.store.upsertDevice(userId, deviceId, {
      tokenVersion: deviceVersion,
      ...(options.deviceLabel && { deviceLabel: options.deviceLabel }),
      issuedAt:   now,
      lastSeenAt: now,
      lastJti:    jti,
    }, guildId);

    await this.emit({
      type:      "token.issued",
      userId,
      deviceId,
      guildId,
      jti,
      timestamp: Date.now(),
    });

    return token;
  }


  async verify(token: string, options: { skipRotationCheck?: boolean } = {}): Promise<VerifiedToken> {
    let parsedUserId: string | undefined;
    let parsedPayload: TokenPayload | undefined;
    let specificEventEmitted = false;

    try {
      if (typeof token !== "string" || !token.startsWith("R")) {
        throw new TokenError("INVALID_FORMAT", "Token must be a string starting with R");
      }

      const dotIdx = token.lastIndexOf(".");
      if (dotIdx === -1) {
        throw new TokenError("INVALID_FORMAT", "Token missing signature separator");
      }

      const body        = token.slice(0, dotIdx);
      const providedSig = token.slice(dotIdx + 1);

      if (!providedSig) {
        throw new TokenError("INVALID_FORMAT", "Token has empty signature");
      }

      const underscoreIdx = body.indexOf("_");
      if (underscoreIdx === -1) {
        throw new TokenError("INVALID_FORMAT", "Token missing _ separator");
      }

      const userPart    = body.slice(1, underscoreIdx);
      const payloadPart = body.slice(underscoreIdx + 1);

      try {
        parsedUserId = b64Decode(userPart);
      } catch {
        throw new TokenError("INVALID_FORMAT", "Malformed userId segment");
      }

      let rawPayload: unknown;
      try {
        rawPayload = JSON.parse(b64Decode(payloadPart));
      } catch {
        throw new TokenError("INVALID_FORMAT", "Malformed payload segment");
      }

      const rawObj = rawPayload as Record<string, unknown>;
      const embeddedVersion = typeof rawObj?.tokenVersion === "string" ? rawObj.tokenVersion : "0:0";

      validateSnowflake(parsedUserId);

      const key         = this.signingKey(parsedUserId, embeddedVersion);
      const expectedSig = sign(body, key);

      if (!safeEqual(providedSig, expectedSig)) {
        throw new TokenError("INVALID_SIGNATURE", "Token signature is invalid");
      }
      assertPayloadShape(rawPayload);
      parsedPayload = rawPayload;

      if (parsedPayload.userId !== parsedUserId) {
        throw new TokenError("INVALID_FORMAT", "userId mismatch between header and payload");
      }

      if (parsedPayload.iss !== this.issuer) {
        throw new TokenError("INVALID_ISSUER", `Token issuer "${parsedPayload.iss}" does not match expected "${this.issuer}"`);
      }
      if (parsedPayload.aud !== this.audience) {
        throw new TokenError("INVALID_AUDIENCE", `Token audience "${parsedPayload.aud}" does not match expected "${this.audience}"`);
      }

      const now = Math.floor(Date.now() / 1000);
      if (parsedPayload.exp <= now) {
        specificEventEmitted = true;
        await this.emit({
          type:      "token.expired",
          userId:    parsedPayload.userId,
          deviceId:  parsedPayload.deviceId,
          guildId:   parsedPayload.guildId,
          jti:       parsedPayload.jti,
          timestamp: Date.now(),
        });
        throw new TokenError("TOKEN_EXPIRED", "Token has expired");
      }

      const globalVersion = await this.store.getGlobalVersion(parsedPayload.userId);
      const deviceVersion = await this.store.getDeviceVersion(parsedPayload.userId, parsedPayload.deviceId, parsedPayload.guildId);
      const expectedVersion = packVersion(globalVersion, deviceVersion);

      if (parsedPayload.tokenVersion !== expectedVersion) {
        throw new TokenError("TOKEN_REVOKED", "Token has been revoked");
      }

      if (!options.skipRotationCheck) {
        const lastJti = await this.store.getLastJti(parsedPayload.userId, parsedPayload.deviceId, parsedPayload.guildId);
        if (lastJti && lastJti !== parsedPayload.jti) {
          await this.store.incrementDeviceVersion(parsedPayload.userId, parsedPayload.deviceId, parsedPayload.guildId);
          specificEventEmitted = true;
          await this.emit({
            type:      "token.rotation_attack",
            userId:    parsedPayload.userId,
            deviceId:  parsedPayload.deviceId,
            guildId:   parsedPayload.guildId,
            jti:       parsedPayload.jti,
            reason:    `Expected jti=${lastJti}, got jti=${parsedPayload.jti}`,
            timestamp: Date.now(),
          });
          throw new TokenError("TOKEN_REVOKED", "Token reuse detected — device has been revoked");
        }
      }

      await this.store.upsertDevice(parsedPayload.userId, parsedPayload.deviceId, {
        lastSeenAt: Math.floor(Date.now() / 1000),
      }, parsedPayload.guildId);

      await this.emit({
        type:      "token.verified",
        userId:    parsedPayload.userId,
        deviceId:  parsedPayload.deviceId,
        guildId:   parsedPayload.guildId,
        jti:       parsedPayload.jti,
        timestamp: Date.now(),
      });

      return { payload: parsedPayload, raw: token };

    } catch (err) {
      if (err instanceof TokenError && !specificEventEmitted) {
        await this.emit({
          type:      "token.verify_failed",
          userId:    parsedUserId,
          deviceId:  parsedPayload?.deviceId,
          guildId:   parsedPayload?.guildId,
          jti:       parsedPayload?.jti,
          reason:    err.message,
          timestamp: Date.now(),
        });
        try {
          await this.onVerifyFailure?.(err);
        } catch {
        }
      } else if (err instanceof TokenError && specificEventEmitted) {
        try {
          await this.onVerifyFailure?.(err);
        } catch {
        }
      }
      throw err;
    }
  }

  async revokeAll(userId: string): Promise<number> {
    validateSnowflake(userId);
    const newVersion = await this.store.incrementGlobalVersion(userId);
    await this.emit({
      type:      "token.revoked_all",
      userId,
      timestamp: Date.now(),
    });
    return newVersion;
  }

  async revokeDevice(userId: string, deviceId: string, guildId?: string): Promise<number> {
    validateSnowflake(userId);
    const newVersion = await this.store.incrementDeviceVersion(userId, deviceId, guildId);
    await this.store.upsertDevice(userId, deviceId, {
      lastSeenAt: Math.floor(Date.now() / 1000),
    }, guildId);
    await this.emit({
      type:      "token.revoked_device",
      userId,
      deviceId,
      guildId,
      timestamp: Date.now(),
    });
    return newVersion;
  }

  async listDevices(userId: string): Promise<DeviceTokenMeta[]> {
    validateSnowflake(userId);
    return this.store.listDevices(userId);
  }

  async refresh(token: string, options: TokenRefreshOptions = {}): Promise<string> {
    const { payload } = await this.verify(token, { skipRotationCheck: true });

    let bits: Bit[];
    let staleBitsWarning: string | undefined;
    if (options.getBits) {
      bits = await options.getBits(payload.userId, payload.guildId);
    } else {
      bits = payload.bits;
      staleBitsWarning = "no getBits provided — old bits preserved (potentially stale)";
    }

    const newToken = await this.issue(payload.userId, {
      deviceId:    payload.deviceId,
      deviceLabel: payload.deviceLabel,
      bits,
      guildId: payload.guildId,
      useDeviceVersion: true,
    });

    await this.emit({
      type:      "token.refreshed",
      userId:    payload.userId,
      deviceId:  payload.deviceId,
      guildId:   payload.guildId,
      jti:       payload.jti,
      ...(staleBitsWarning && { reason: staleBitsWarning }),
      timestamp: Date.now(),
    });

    return newToken;
  }

  hasBit(verified: VerifiedToken, bit: Bit): boolean {
    return verified.payload.bits.includes(bit);
  }

  requireBit(verified: VerifiedToken, bit: Bit): void {
    if (!this.hasBit(verified, bit)) {
      throw new TokenError("PERMISSION_DENIED", `Token does not have required bit: "${bit}"`);
    }
  }

  requireBits(verified: VerifiedToken, ...bits: Bit[]): void {
    for (const b of bits) {
      this.requireBit(verified, b);
    }
  }

  debugDecodeUnsafe(token: string, _debugFlag: "I_UNDERSTAND_THIS_IS_UNSAFE"): Partial<TokenPayload> | null {
    try {
      const dotIdx = token.lastIndexOf(".");
      if (dotIdx === -1) return null;
      const body           = token.slice(0, dotIdx);
      const underscoreIdx  = body.indexOf("_");
      if (underscoreIdx === -1) return null;
      const payloadPart = body.slice(underscoreIdx + 1);
      const raw = JSON.parse(b64Decode(payloadPart)) as Partial<TokenPayload>;
      return { ...raw, tokenVersion: undefined };
    } catch {
      return null;
    }
  }
}

export type TokenErrorCode =
  | "INVALID_FORMAT"
  | "INVALID_SIGNATURE"
  | "INVALID_SNOWFLAKE"
  | "INVALID_PERMISSION"
  | "INVALID_ISSUER"
  | "INVALID_AUDIENCE"
  | "TOKEN_EXPIRED"
  | "TOKEN_REVOKED"
  | "PERMISSION_DENIED";

export class TokenError extends Error {
  constructor(
    public readonly code: TokenErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TokenError";
  }
}

function validateSnowflake(id: string): void {
  if (typeof id !== "string" || !/^\d{17,19}$/.test(id)) {
    throw new TokenError("INVALID_SNOWFLAKE", `"${id}" is not a valid Discord snowflake`);
  }
}

function assertPayloadShape(p: unknown): asserts p is TokenPayload {
  if (typeof p !== "object" || p === null)
    throw new TokenError("INVALID_FORMAT", "Payload is not an object");

  const o = p as Record<string, unknown>;

  if (typeof o.userId       !== "string")  throw new TokenError("INVALID_FORMAT", "Missing or invalid userId");
  if (typeof o.iat          !== "number")  throw new TokenError("INVALID_FORMAT", "Missing or invalid iat");
  if (typeof o.exp          !== "number")  throw new TokenError("INVALID_FORMAT", "Missing or invalid exp");
  if (typeof o.jti          !== "string")  throw new TokenError("INVALID_FORMAT", "Missing or invalid jti");
  if (typeof o.deviceId     !== "string")  throw new TokenError("INVALID_FORMAT", "Missing or invalid deviceId");
  if (!Array.isArray(o.bits))              throw new TokenError("INVALID_FORMAT", "Missing or invalid bits");
  if (o.guildId !== undefined && typeof o.guildId !== "string")
    throw new TokenError("INVALID_FORMAT", "Invalid guildId");
  if (typeof o.tokenVersion !== "string")  throw new TokenError("INVALID_FORMAT", "Missing or invalid tokenVersion");
  if (typeof o.iss          !== "string")  throw new TokenError("INVALID_FORMAT", "Missing or invalid iss");
  if (typeof o.aud          !== "string")  throw new TokenError("INVALID_FORMAT", "Missing or invalid aud");

  if (o.exp <= o.iat)
    throw new TokenError("INVALID_FORMAT", "exp must be after iat");
  if ((o.exp as number) - (o.iat as number) > 7 * 24 * 3600)
    throw new TokenError("INVALID_FORMAT", "Token TTL exceeds 7-day maximum");
  if (!/^\d+:\d+$/.test(o.tokenVersion as string))
    throw new TokenError("INVALID_FORMAT", "tokenVersion has invalid format");
}

export async function extractBearer(
  authHeader: string | null | undefined,
  manager: TokenManager
): Promise<VerifiedToken> {
  if (!authHeader) {
    throw new TokenError("INVALID_FORMAT", "Missing Authorization header");
  }

  const spaceIdx = authHeader.indexOf(" ");
  if (spaceIdx === -1) {
    throw new TokenError("INVALID_FORMAT", "Authorization header must be: Bearer <token>");
  }

  const scheme = authHeader.slice(0, spaceIdx);
  const token  = authHeader.slice(spaceIdx + 1).trim();

  if (scheme !== "Bearer") {
    throw new TokenError("INVALID_FORMAT", `Unsupported auth scheme: "${scheme}"`);
  }

  if (!token || token.includes(" ")) {
    throw new TokenError("INVALID_FORMAT", "Authorization header token must not contain spaces");
  }

  return manager.verify(token);
}

export async function extractCookie(
  cookieHeader: string | null | undefined,
  manager: TokenManager,
  cookieName = "auth_token"
): Promise<VerifiedToken> {
  if (!cookieHeader) {
    throw new TokenError("INVALID_FORMAT", "Missing Cookie header");
  }

  const token = cookieHeader
    .split(";")
    .map(part => part.trim().split("="))
    .find(([name]) => name === cookieName)
    ?.[1];

  if (!token) {
    throw new TokenError("INVALID_FORMAT", `Cookie "${cookieName}" not found`);
  }

  return manager.verify(decodeURIComponent(token));
}

export function requireAuth(
  manager: TokenManager,
  options: { bits?: Bit[] } = {}
) {
  return async (req: any, res: any, next: any): Promise<void> => {
    try {
      const verified = await extractBearer(req.headers.authorization, manager);

      if (options.bits) {
        for (const bit of options.bits) {
          manager.requireBit(verified, bit);
        }
      }

      req.auth = verified;
      next();
    } catch (err) {
      if (err instanceof TokenError) {
        const status =
          err.code === "PERMISSION_DENIED" ? 403 :
          err.code === "TOKEN_EXPIRED"     ? 401 :
          err.code === "TOKEN_REVOKED"     ? 401 : 401;

        res.status(status).json({ error: err.code, message: err.message });
        return;
      }
      next(err);
    }
  };
}

export class InMemoryTokenStore implements TokenStore {
  private globalVersions  = new Map<string, number>();
  private deviceVersions  = new Map<string, number>();
  private deviceMeta      = new Map<string, DeviceTokenMeta>();

  async getGlobalVersion(userId: string): Promise<number> {
    return this.globalVersions.get(userId) ?? 0;
  }

  async incrementGlobalVersion(userId: string): Promise<number> {
    const next = (this.globalVersions.get(userId) ?? 0) + 1;
    this.globalVersions.set(userId, next);
    return next;
  }

  private deviceKey(userId: string, deviceId: string, guildId?: string): string {
    return guildId ? `${guildId}:${userId}:${deviceId}` : `${userId}:${deviceId}`;
  }

  async getDeviceVersion(userId: string, deviceId: string, guildId?: string): Promise<number> {
    return this.deviceVersions.get(this.deviceKey(userId, deviceId, guildId)) ?? 0;
  }

  async incrementDeviceVersion(userId: string, deviceId: string, guildId?: string): Promise<number> {
    const key  = this.deviceKey(userId, deviceId, guildId);
    const next = (this.deviceVersions.get(key) ?? 0) + 1;
    this.deviceVersions.set(key, next);
    return next;
  }

  async upsertDevice(
    userId: string,
    deviceId: string,
    meta: Partial<Omit<DeviceTokenMeta, "_id" | "userId" | "deviceId" | "guildId">>,
    guildId?: string
  ): Promise<void> {
    const key      = this.deviceKey(userId, deviceId, guildId);
    const existing = this.deviceMeta.get(key) ?? {
      _id:        key,
      userId,
      deviceId,
      guildId,
      tokenVersion: 0,
      issuedAt:   Math.floor(Date.now() / 1000),
      lastSeenAt: Math.floor(Date.now() / 1000),
    };
    this.deviceMeta.set(key, { ...existing, ...meta });
  }

  async listDevices(userId: string): Promise<DeviceTokenMeta[]> {
    return [...this.deviceMeta.values()].filter(v => v.userId === userId);
  }

  async deleteDevice(userId: string, deviceId: string, guildId?: string): Promise<void> {
    const key = this.deviceKey(userId, deviceId, guildId);
    this.deviceVersions.delete(key);
    this.deviceMeta.delete(key);
  }

  async getLastJti(userId: string, deviceId: string, guildId?: string): Promise<string | undefined> {
    return this.deviceMeta.get(this.deviceKey(userId, deviceId, guildId))?.lastJti;
  }
}