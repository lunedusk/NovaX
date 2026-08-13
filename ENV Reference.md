# NovaX — Environment Variable Reference

> **Framework Version:** NovaX v0.1.13
> **Last Updated:** 2026
> **Node.js Requirement:** ≥ 20

This document is the complete reference for every environment variable recognized by the NovaX framework. Variables are read from your `.env` file at startup via `dotenv` and managed through the internal `secretManager`. Once the application boots, the secret store is locked — changes to `.env` require a full restart to take effect.

---

## Table of Contents

1. [How to Use This Document](#1-how-to-use-this-document)
2. [Configuration Sources — `.env` vs `common.json`](#2-configuration-sources--env-vs-commonjson)
3. [Core Identity](#3-core-identity)
4. [Cryptographic Keys & Plugin Integrity](#4-cryptographic-keys--plugin-integrity)
5. [Discord Connection](#5-discord-connection)
6. [Logging](#6-logging)
7. [HTTP API Server](#7-http-api-server)
8. [Database](#8-database)
9. [Plugins](#9-plugins)
10. [Internationalisation](#10-internationalisation)
11. [Rate Limiting](#11-rate-limiting)
12. [Hot Reload](#12-hot-reload)
13. [Auto Updater](#13-auto-updater)
14. [Authentication & Tokens](#14-authentication--tokens)
15. [Full `.env` Template](#15-full-env-template)
16. [Quick-Reference Table](#16-quick-reference-table)

---

## 1. How to Use This Document

Each variable entry follows this structure:

| Field | Meaning |
|---|---|
| **Required** | Whether the bot will refuse to start if this is absent |
| **Default** | The value used when the variable is not set |
| **Safe to Change** | Whether a live change (followed by restart) is low-risk |
| **Breaking Risk** | Whether changing this can cause data loss, auth failures, or outages |
| **Recommended Action** | What you should actually do with this variable |

> ⚠️ **Danger** entries are variables where an incorrect value can cause **data corruption, bot bans, plugin rejection, or security vulnerabilities**. Read the full description before touching them.

---

## 2. Configuration Sources — `.env` vs `common.json`

NovaX supports **two ways** to supply configuration values. Understanding how they interact is essential before you set anything up.

### Option A — `.env` File (Standard)

The standard approach. Create a `.env` file at the project root. Values are loaded at startup by `dotenv` and read through the `secretManager`. The secret store is **locked after boot** — no live changes without a restart.

```
project-root/
├── .env          ← your configuration lives here
├── plugins/
└── ...
```

This is the recommended approach for all production deployments and most development setups.

### Option B — `common.json` (Alternative Config Source)

`common.json` is a structured JSON file at the project root that gives you a **typed, panel-friendly alternative** to `.env`. It is processed by the `Common777` internal system during the very first phase of bootstrap — before the plugin system, before Discord login, before anything else.

```
project-root/
├── common.json   ← alternative to .env
├── plugins/
└── ...
```

#### File Structure

`common.json` must always contain an `__info__` block with `__author__` set to exactly `"Lunedusk"`. The framework validates this on every boot and will exit with a security error if it is missing or incorrect — this is an integrity lock to prevent accidental use of a foreign config file.

```json
{
    "__info__": {
        "__author__": "Lunedusk",
        "version": "auto"
    },
    "ENVSettings": false,
    "DiscordToken": "your_bot_token_here",
    "DiscordIntents": ["Guilds", "GuildMessages", "MessageContent"],
    "DefaultLocale": "en",
    "APIPort": 3000,
    "TZ": "UTC",
    "Database": {"main": {"uri": "novadb://local", "engine": "native-novadb"}}
}
```

> ℹ️ The `version` field inside `__info__` is **always overwritten** by the framework with the value from `package.json` at boot. You can set it to anything; it will be replaced.

#### The `ENVSettings` Switch

This is the key field that controls how `common.json` interacts with `process.env`:

| Value | Behaviour |
|---|---|
| `true` | **Respect `.env` / existing environment.** `common.json` is loaded but none of its values are written to `process.env`. Effectively a no-op for config injection — only the `__info__` validation and caller identity lock run. |
| `false` | **Inject into environment.** All fields in `common.json` (except `__info__` and `ENVSettings` itself) are serialized and written into `process.env`, overriding or supplementing any `.env` values. |
| *(absent)* | `common.json` is parsed and validated but **no injection occurs** — same effect as `true`. |

#### Value Serialization Rules

When `ENVSettings=false`, values are converted to strings before being written to `process.env`:

| JSON Type | Serialized As |
|---|---|
| `string` | Written as-is |
| `number` / `boolean` | Converted via `String()` |
| `Array` | Joined with commas — `["Guilds", "GuildMessages"]` → `"Guilds,GuildMessages"` |
| `object` | Serialized with `JSON.stringify()` — suitable for `Database` |
| `null` / `undefined` | Skipped entirely |

#### Which Fields Can Go in `common.json`?

Any environment variable documented in this reference can be placed in `common.json` as a top-level key. The field names are identical. Array-typed variables (like `DiscordIntents`) can be provided as a native JSON array instead of a comma-separated string — the serialization step handles the conversion automatically.

```json
{
    "__info__": { "__author__": "Lunedusk", "version": "auto" },
    "ENVSettings": false,

    "NODE_ENV": "production",
    "BotName": "MyBot",
    "DiscordToken": "your_token",
    "DiscordIntents": ["Guilds", "GuildMessages", "MessageContent", "GuildMembers"],
    "LogLevel": "info",
    "TZ": "UTC",
    "APIPort": 3000,
    "isSharded": false,
    "DefaultLocale": "en",
    "EnableGlobalRatelimit": true,
    "hotReloadEnabled": false,
    "allowUnCertifiedPlugins": false,
    "Database": {
        "main": { "uri": "novadb://local", "engine": "native-novadb" }
    },
    "PublicKey": "MCowBQYDK2VwAyEAxGjGVv/sK86Px3N7hLY1x1QxS5bugvrqPlo8MW95BwQ="
}
```

> ⚠️ **Do not put `PrivateKey` in `common.json`.** The same rule that applies to `.env` applies here — the signing key must never live on a production server. If `common.json` is committed to source control or readable by a hosting panel, `PrivateKey` in it is a serious security exposure.

#### Security: Caller Identity Lock

`Common777` performs a **process entry-point lock** on first bootstrap. It records the `process.argv[1]` path of the process that called it and stores it. On every subsequent call to `common777.get()`, it re-checks the entry point. If the path has changed (which would indicate a suspicious runtime injection), the process exits immediately with a security error. You cannot work around this — it is by design.

#### `common.json` vs `.env` — When to Use Which

| Situation | Use |
|---|---|
| Self-hosted VPS / bare metal with SSH access | `.env` |
| Control panel / hosting dashboard (e.g. Pterodactyl) that supports JSON config files | `common.json` with `ENVSettings=false` |
| Control panel that has its own env variable injection | `common.json` with `ENVSettings=true` (let the panel handle env) |
| Development machine | Either — `.env` is simpler |
| You want typed arrays for `DiscordIntents` without comma-string formatting | `common.json` |

#### Precedence

If both `.env` and `common.json` exist and `ENVSettings=false`, `common.json` values are written into `process.env` **after** `dotenv` has already loaded `.env`. This means **`common.json` wins** on any key that appears in both files when `ENVSettings=false`. If `ENVSettings=true`, `.env` values are untouched and take precedence.

---

## 3. Core Identity

### `NODE_ENV`

Controls the application runtime mode. Affects log verbosity, TypeORM auto-sync behaviour, and various internal safety checks.

| | |
|---|---|
| **Required** | No |
| **Default** | `production` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low |
| **Recommended Action** | Leave as `production` in deployment. Set to `development` on a local machine only. |

**Accepted values:** `production`, `development`

When set to `development`, the log level defaults to `debug` (verbose), TypeORM will auto-sync database tables, and certain safety guards are relaxed. Never run a public-facing bot in `development` mode — it leaks internal debug output.

```env
NODE_ENV=production
```

---

### `BotName`

The display name of the bot used in internal logs, panel status messages, and any framework-generated strings that reference the bot's identity.

| | |
|---|---|
| **Required** | No |
| **Default** | *(none — logs will show the Discord tag instead)* |
| **Safe to Change** | Yes |
| **Breaking Risk** | None |
| **Recommended Action** | Set this to your bot's name for cleaner log output. |

```env
BotName=MyBot
```

---

### `BotOwnerIds`

A comma-separated list of Discord user Snowflake IDs that are treated as **bot owners**. Bot owners bypass all permission checks — they receive every permission bit automatically and are never denied by `canExecute()`.

| | |
|---|---|
| **Required** | No |
| **Default** | *(empty — no one is treated as a bot owner)* |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | **HIGH** — adding an incorrect user ID grants that person full, unrestricted control over every command and API endpoint. Removing a valid owner ID locks them out of owner-only commands instantly. |
| **Recommended Action** | Set this to your own Discord user ID. Add additional trusted admins only when necessary. Never include IDs of users you do not fully trust — bot owners can manage roles, revoke tokens, and access all admin commands. |

To find your Discord user ID: enable Developer Mode in Discord settings, then right-click your username and select "Copy User ID".

```env
# Single owner
BotOwnerIds=123456789012345678

# Multiple owners
BotOwnerIds=123456789012345678,987654321098765432
```

---

## 4. Cryptographic Keys & Plugin Integrity

NovaX uses **Ed25519** asymmetric signatures to verify the authenticity and integrity of plugins distributed as `.nvx` manifests. The public/private key pair works together — if you change one, you must change the other.

---

### `PublicKey`

The Ed25519 public key used to verify `.nvx` plugin manifests at startup. If a plugin's signature does not match this key, it is rejected outright.

| | |
|---|---|
| **Required** | No (see note below) |
| **Default** | `MCowBQYDK2VwAyEAxGjGVv/sK86Px3N7hLY1x1QxS5bugvrqPlo8MW95BwQ=` *(Lunedusk developer key)* |
| **Safe to Change** | Only if you are also replacing `PrivateKey` |
| **Breaking Risk** | **HIGH** — changing this without a matching `PrivateKey` will cause all signed plugins to fail integrity checks and be rejected |
| **Recommended Action** | **Leave at default** unless you are self-signing your own plugins. If you distribute your own certified plugins, replace both `PublicKey` and `PrivateKey` with your own generated Ed25519 key pair. |

The default value is the Lunedusk developer public key, which allows you to run any officially signed NovaX plugin without configuration. If you generate your own key pair (required for distributing your own certified plugins), the value must be the raw Base64-encoded public key **without** PEM headers.

> ⚠️ **This key and `PrivateKey` are a matched pair.** If you change `PublicKey`, you must also have the corresponding `PrivateKey` available, and you must re-sign all plugins with it. Mismatching these will silently reject every plugin on startup.

```env
PublicKey=MCowBQYDK2VwAyEAxGjGVv/sK86Px3N7hLY1x1QxS5bugvrqPlo8MW95BwQ=
```

---

### `PrivateKey`

The Ed25519 private key used by the **plugin packer** (`npm run pack <plugin_id>`) to sign `.nvx` manifests. This key is **never used by the bot at runtime** — it is only needed when building and signing plugin distributions.

| | |
|---|---|
| **Required** | No — only needed when running the packer script |
| **Default** | *(none)* |
| **Safe to Change** | Only alongside `PublicKey` |
| **Breaking Risk** | **CRITICAL** — treat this like a password. Do not commit it to source control. Do not share it. |
| **Recommended Action** | Only set this on a build machine or developer machine. **Never set this on a production bot server.** |

The value may be provided as a raw Base64 string (without PEM headers) or as a full PEM block. The packer accepts both formats.

If this key is absent when you run `npm run pack`, the packer will exit with an error. If you are not packaging plugins, you do not need this variable at all.

> 🔒 **Security Notice:** `PrivateKey` grants the ability to produce signatures that your bot will trust. Anyone with this value can sign arbitrary plugins that your bot will load and execute. Store it in a secrets vault, not in a committed `.env` file.

```env
# Raw Base64 format (no PEM headers required)
PrivateKey=MC4CAQAwBQYDK2VwBCIEI...
```

---

## 5. Discord Connection

### `DiscordToken`

The bot token obtained from the [Discord Developer Portal](https://discord.com/developers/applications). This is the primary credential used to authenticate with the Discord Gateway.

| | |
|---|---|
| **Required** | **YES — the bot cannot start without this** |
| **Default** | *(none)* |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | **CRITICAL** — an incorrect or leaked token can result in your bot being disabled by Discord |
| **Recommended Action** | Set this and protect it. Never share it. Never commit it to source control. If leaked, regenerate it immediately from the Developer Portal. |

> 🔒 **Security Notice:** Your bot token is equivalent to a username and password combined. Anyone with this value has full control of your bot account, including sending messages, joining servers, and making API calls. The logger automatically redacts known sensitive fields, but you should never log this value manually.

```env
DiscordToken=your_bot_token_here
```

---

### `DiscordIntents`

A comma-separated list of Discord Gateway intent names to enable when logging in. This controls which events the bot receives from Discord.

| | |
|---|---|
| **Required** | No |
| **Default** | All **unprivileged** intents (safe fallback — see below) |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Medium — removing an intent that a plugin depends on will silently break that plugin's event listeners without any startup error |
| **Recommended Action** | **Explicitly set this** to the intents your plugins actually need. Leaving it unset works but causes the framework to log a warning on every boot indicating no intents were specified. Defining it explicitly silences that warning and makes your intent requirements clear and auditable. |

#### Format

The value is a **comma-separated string** of intent names passed directly to the `IntentBuilder`. Names are **case-insensitive** and **underscore-insensitive** — `GuildMessages`, `guildmessages`, and `guild_messages` are all equivalent.

```env
# Comma-separated, case-insensitive, underscores optional
DiscordIntents=Guilds,GuildMessages,MessageContent,GuildMembers
```

#### Special Keywords

In addition to individual intent names, three special keywords are supported:

| Keyword | Behaviour |
|---|---|
| *(not set / empty)* | Loads all **unprivileged** intents — the safest default |
| `default` or `unprivileged` | Explicitly loads all unprivileged intents (same as leaving unset) |
| `all` | Loads **every** intent including all three privileged ones — use with care |

Keywords can be combined with individual intent names. For example, `unprivileged,MessageContent` loads all safe intents and additionally requests `MessageContent`.

#### All Available Intent Names

These are the valid `GatewayIntentBits` names from Discord.js v14:

| Intent Name | Privileged | Events Unlocked |
|---|---|---|
| `Guilds` | No | Guild create/update/delete, channel events, role events |
| `GuildMembers` | **YES** | Member join/leave/update |
| `GuildModeration` | No | Ban/unban events |
| `GuildExpressions` | No | Emoji, sticker, soundboard events |
| `GuildIntegrations` | No | Integration create/update/delete |
| `GuildWebhooks` | No | Webhook update events |
| `GuildInvites` | No | Invite create/delete |
| `GuildVoiceStates` | No | Voice state updates |
| `GuildPresences` | **YES** | Presence/status updates |
| `GuildMessages` | No | Message create/update/delete in guilds |
| `GuildMessageReactions` | No | Reaction add/remove in guilds |
| `GuildMessageTyping` | No | Typing start in guilds |
| `DirectMessages` | No | DM message events |
| `DirectMessageReactions` | No | Reaction add/remove in DMs |
| `DirectMessageTyping` | No | Typing start in DMs |
| `MessageContent` | **YES** | Access to `message.content` field |
| `GuildScheduledEvents` | No | Scheduled event create/update/delete |
| `AutoModerationConfiguration` | No | AutoMod rule events |
| `AutoModerationExecution` | No | AutoMod action execution |
| `GuildMessagePolls` | No | Poll create/end in guilds |
| `DirectMessagePolls` | No | Poll create/end in DMs |

#### Privileged Intents

Three intents are marked **Privileged** by Discord and require additional steps:

- `GuildMembers`
- `GuildPresences`
- `MessageContent`

For each privileged intent you enable:
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application → **Bot** tab
3. Scroll to **Privileged Gateway Intents** and toggle the relevant intent **ON**

> ⚠️ **If a privileged intent is listed in `DiscordIntents` but not enabled in the Developer Portal, Discord will reject the Gateway connection and the bot will fail to start entirely.** The framework will log a warning at startup listing every privileged intent it is about to request, giving you a chance to verify before the connection attempt.

> ⚠️ **Bots in 100+ servers** that request privileged intents must apply for verification via the Developer Portal. Using privileged intents in large bots without approval violates Discord's ToS and can result in your bot being disabled.

#### Examples

```env
# Minimum viable — just guild structure and message events (no content access)
DiscordIntents=Guilds,GuildMessages

# Standard bot — guild events + message content reading + member tracking
DiscordIntents=Guilds,GuildMessages,MessageContent,GuildMembers

# Moderation-focused bot — add reaction and voice state tracking
DiscordIntents=Guilds,GuildMessages,MessageContent,GuildMembers,GuildMessageReactions,GuildVoiceStates,GuildModeration

# All unprivileged intents (same as leaving the variable unset)
DiscordIntents=unprivileged

# Everything — requires all three privileged intents enabled in Developer Portal
DiscordIntents=all
```

---

### `GuildID`

A specific Discord server (guild) Snowflake ID. When set, all slash commands are synced to this guild only instead of globally. Guild commands appear instantly; global commands can take up to one hour to propagate.

| | |
|---|---|
| **Required** | No |
| **Default** | *(none — commands are registered globally)* |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Low — switching from guild to global means commands may be invisible for up to one hour |
| **Recommended Action** | Set this to your development or test server ID during development. **Remove or clear it for production deployments** so commands are available everywhere. |

```env
GuildID=123456789012345678
```

---

### `isSharded`

Enables Discord Sharding Mode. When `true`, the process launches a `ShardingManager` that spawns worker processes to handle separate Gateway shards. Required for bots in 2,500+ servers.

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes (requires full restart) |
| **Breaking Risk** | Medium — enabling sharding changes the process architecture significantly; ensure your plugins and database are shard-safe before enabling |
| **Recommended Action** | Leave `false` unless you are in 2,500+ guilds. The framework handles shard spawning automatically once enabled. |

```env
isSharded=false
```

---

## 6. Logging

### `LogLevel`

The minimum severity level for log output. Messages below this level are suppressed.

| | |
|---|---|
| **Required** | No |
| **Default** | `info` in production, `debug` in development |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | None |
| **Recommended Action** | Keep at `info` for production. Use `debug` temporarily when diagnosing issues. |

**Level hierarchy (lowest to highest severity):**

| Level | When to use |
|---|---|
| `debug` | Verbose internal tracing — plugin preload details, cache hits, route resolution |
| `info` | Normal operational events — startup, plugin boot, command sync |
| `warn` | Non-fatal anomalies — missing optional config, integrity bypass active |
| `error` | Recoverable errors — plugin boot failure, DB connection retry |
| `fatal` | Unrecoverable crash — application will exit after logging |

Setting `LogLevel=warn` will suppress all `info` and `debug` output. Setting it to `debug` will produce very high volume output — do not use in production unless actively troubleshooting.

```env
LogLevel=info
```

---

### `LogTZ`

The IANA timezone string used to format timestamps in log output and rotating log file names.

| | |
|---|---|
| **Required** | No |
| **Default** | `UTC` (falls back to `process.env.TZ` if set, then `UTC`) |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | None |
| **Recommended Action** | Set to your server's local timezone for readable timestamps in log files. Examples: `America/New_York`, `Europe/London`, `Asia/Kolkata`. |

This only affects **display** — all internal timestamps are still UTC epoch values. Log files are rotated daily based on this timezone.

```env
LogTZ=UTC
```

---

## 7. HTTP API Server

### `APIPort`

The TCP port the built-in Express HTTP server binds to. This server exposes REST endpoints registered by plugins via `RouteLoader`, as well as the internal Prometheus metrics endpoint.

| | |
|---|---|
| **Required** | No |
| **Default** | `3000` |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Low — any reverse proxy or external service pointing at the old port will break until updated |
| **Recommended Action** | Change if port 3000 conflicts with another service. Remember to update your reverse proxy configuration accordingly. |

The HTTP server only starts on the **primary shard** (shard 0 or standalone mode). In multi-shard deployments, only one HTTP server is active.

```env
APIPort=3000
```

### `ApiKey`

The master API gateway key used when the gateway runs in env mode. When `configuration/api.json5` enables env mode, NovaX reads this value from the secrets manager and uses it as the gateway's primary authentication credential.

| | |
|---|---|
| **Required** | **Yes — if API gateway env mode is enabled** |
| **Default** | *(none — must be supplied through `.env`, `common.json`, or another secrets-backed source)* |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | **CRITICAL** — changing or leaking this value affects gateway authentication immediately |
| **Recommended Action** | Store this in a secrets manager or protected environment file. Rotate it only during a maintenance window, and update any gateway clients at the same time. |

Generate a strong value:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```env
ApiKey=your_gateway_master_key_here
```

> 🔒 **Security Notice:** This is the master credential for the API gateway when env mode is enabled. Treat it like a root password: never commit it, never paste it into a shared config file, and rotate it immediately if exposure is suspected.

---

## 8. Database

### `Database`

A JSON object defining all database connections the bot should establish at startup. Each key is an **alias** you use to access the database in code; the value is a configuration object.

| | |
|---|---|
| **Required** | No |
| **Default** | `{}` — an automatic `native-novadb` instance named `main` is provisioned as fallback |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | **HIGH** — changing the alias of an existing database will cause plugins that reference the old alias to fail; changing the URI of a stateful database (NovaDB, SQLite, PostgreSQL) without migrating data first will result in data loss |
| **Recommended Action** | Define all your databases here. Never change an alias after a plugin has written data to it. Test database changes against a backup first. |

#### Format

```env
Database={"alias": {"uri": "...", "engine": "...", "poolSize": 10, "maxRetries": 5}}
```

#### Configuration Properties

| Property | Type | Required | Default | Description |
|---|---|---|---|---|
| `uri` | string | **Yes** | — | Connection string for the database |
| `engine` | string | No | Auto-detected from URI protocol | Database driver to use (see supported engines below) |
| `poolSize` | number | No | `10` | Maximum simultaneous connections |
| `maxRetries` | number | No | `5` (user-defined entries); `3` (auto-provisioned `main` NovaDB fallback) | Connection retry attempts on startup failure |

#### Supported Engines

| Engine Key | Description | URI Format Example |
|---|---|---|
| `native-novadb` | Built-in embedded document store. Data stored in `.data/database/{alias}/`. No external server needed. | `novadb://local` |
| `mongo` | MongoDB via Mongoose | `mongodb+srv://user:pass@host/db` |
| `redis` | Redis — automatically creates **Main**, **Pub**, and **Sub** clients for this alias | `redis://127.0.0.1:6379` |
| `native-pg` | PostgreSQL via the `pg` driver | `postgresql://user:pass@localhost:5432/db` |
| `native-sqlite` | SQLite via `better-sqlite3`. WAL mode applied automatically. | `sqlite://./data/my.db` |
| `typeorm` | TypeORM ORM — supports `postgres`, `mysql`, `mariadb`, `sqlite` | `mysql://user:pass@localhost:3306/db` |

#### Accessing Databases in Plugin Code

```ts
// NovaDB
const db = await this.heart.db.nova.get('main').collection('users');

// Redis
const redis = this.heart.db.redis.get('cache');
await redis.main.set('key', 'value');
await redis.pub.publish('channel', 'message');

// PostgreSQL
const pg = this.heart.db.postgres.get('analytics');

// MongoDB
const mongo = this.heart.db.mongo.get('main');

// SQLite
const sqlite = this.heart.db.sqlite.get('localdb');

// TypeORM
const orm = this.heart.db.orm.get('main');
```

#### Multi-Database Example

```env
Database={"main": {"uri": "novadb://local", "engine": "native-novadb"}, "cache": {"uri": "redis://localhost:6379", "engine": "redis"}, "analytics": {"uri": "postgresql://user:pass@host:5432/stats", "engine": "native-pg", "poolSize": 5}}
```

> ⚠️ **Alias stability is critical.** Once a plugin stores data under an alias (e.g. `main`), renaming that alias orphans all existing data. Treat aliases as permanent identifiers.

```env
Database={"main": {"uri": "novadb://local", "engine": "native-novadb"}}
```

---

### `DisableDefaultNovaDB`

When `true`, suppresses the automatic provisioning of a fallback `main` NovaDB instance. Normally, if no `"main"` database is defined in `Database`, the framework creates one automatically.

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | **HIGH** — many core plugins depend on the `main` NovaDB instance. Disabling it without explicitly configuring an alternative `main` database will cause those plugins to fail at boot. |
| **Recommended Action** | **Leave at `false` unless you have explicitly defined a `"main"` database in your `Database` config.** Only use this if you intentionally want no embedded database at all and all your plugins are written to use external databases exclusively. |

```env
DisableDefaultNovaDB=false
```

---

### `DisableDefaultSqlite`

When `true`, suppresses the automatic provisioning of a fallback `main` SQLite instance at `.data/database-sqlite/main.db`. Normally, if no SQLite `"main"` database exists after all configured databases are initialized, the framework creates one automatically for use by the permission system and other core features.

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | **HIGH** — the permission system (`PermissionsManager`, `PermissionCache`) and token system (`SqliteTokenStore`) depend on a SQLite `main` instance. Disabling it without providing an alternative SQLite database in your `Database` config will cause these core systems to crash at boot. |
| **Recommended Action** | **Leave at `false`.** Only set to `true` if you have explicitly configured a `"main"` SQLite database in your `Database` env variable using the `native-sqlite` engine. |

```env
DisableDefaultSqlite=false
```

---

## 9. Plugins

### `allowUnCertifiedPlugins`

When `true`, allows plugins **without** a valid `.nvx` signed manifest to load using their `manifest.json` file directly. This bypasses all cryptographic integrity verification.

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | **SECURITY RISK** — enabling this means any code placed in your `plugins/` directory will run without verification. Only enable in a fully controlled, trusted environment. |
| **Recommended Action** | **Leave at `false` in production.** Use `whitelistedPlugins` for granular bypass of specific plugins you trust, rather than bypassing everything globally. |

> 🔒 **Security Notice:** Plugins run with full Node.js process privileges. A malicious plugin can access your `DiscordToken`, database contents, and file system. Only load plugins you have either personally written or that are signed with a trusted `PublicKey`.

```env
allowUnCertifiedPlugins=false
```

---

### `whitelistedPlugins`

A comma-separated list of specific plugin directory names that are allowed to bypass the `.nvx` signature check and load from their `manifest.json` directly. Provides granular bypass without opening the door to all unsigned plugins.

| | |
|---|---|
| **Required** | No |
| **Default** | *(none — empty list)* |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Medium security risk — each whitelisted plugin runs without cryptographic verification |
| **Recommended Action** | Use this during active plugin development when you have not yet packed the plugin with `npm run pack`. Remove entries once a plugin is properly signed. |

Plugin IDs must match their directory names exactly (kebab-case).

```env
whitelistedPlugins=my-dev-plugin,another-wip-plugin
```

---

## 10. Internationalisation

### `DefaultLocale`

Sets the fallback locale used by the Language Manager when a translation key is not found in the requested locale, or when no locale is explicitly specified.

| | |
|---|---|
| **Required** | No |
| **Default** | `en` |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Low — changing this to a locale that has no translation files will cause all `i18n.get()` calls to return raw `namespace:key` strings |
| **Recommended Action** | Leave at `en` unless your bot's primary audience speaks a different language and you have full translation coverage for that locale. |

The Language Manager resolves translations using a fallback chain: `requested locale → base locale → DefaultLocale → en`. Setting `DefaultLocale` to a locale with incomplete coverage means users may see raw keys instead of text.

Supported built-in locales: `en`, `es`, `fr`, `de`. Custom locale codes are accepted but flagged with a warning.

```env
DefaultLocale=en
```

---

## 11. Rate Limiting

### `EnableGlobalRatelimit`

Toggles the framework-level global rate limiter that applies across all Discord interactions. When enabled, a user who triggers interactions too quickly receives an ephemeral cooldown message instead of executing the command.

| | |
|---|---|
| **Required** | No |
| **Default** | `true` |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Low — disabling it may increase Discord API pressure and make your bot vulnerable to spam abuse |
| **Recommended Action** | **Leave enabled.** Only disable temporarily when debugging interaction handling and the rate limiter is interfering with rapid test inputs. |

This is separate from per-command cooldowns defined in plugin code via `CommandConfig.cooldown`. The global rate limiter acts as a coarse filter across the entire interaction pipeline before any command-specific logic runs.

```env
EnableGlobalRatelimit=true
```

---

## 12. Hot Reload

### `hotReloadEnabled`

When `true`, the framework watches the `configuration/` directory (configs and language files) and the emoji assets for file changes and reloads them in memory without requiring a bot restart.

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes (requires restart to toggle) |
| **Breaking Risk** | Low — hot reload is additive; if the watcher fails, the last successfully loaded values remain in memory |
| **Recommended Action** | Enable during development for a faster iteration loop. Keep `false` in production unless you regularly update configs or translations at runtime. |

Hot reload covers: `configuration/` JSON5 config files, `configuration/lang/` translation files, and emoji asset maps. It does **not** hot-reload plugin source code. Plugin source code reloading is a separate, first-class framework feature handled by `PluginManager.reload()` — it fully disables the target plugin, re-discovers it from disk, reinstalls dependencies, re-imports the module with a cache-busting URL, replays the full boot lifecycle, and resyncs Discord commands automatically. This is typically exposed via an admin command in your own plugin that calls the framework method, rather than being triggered by a file watcher.

```env
hotReloadEnabled=false
```

---

## 13. Auto Updater

NovaX can check GitHub for newer **tagged** releases and apply them without a local git repository. The updater runs after compilation via:

```bash
npm run updater
# or with flags:
node --import ./core/dependency/index.mjs ./index.js --updater
node --import ./core/dependency/index.mjs ./index.js --updater --dry-run
node --import ./core/dependency/index.mjs ./index.js --updater --force
node --import ./core/dependency/index.mjs ./index.js --updater --baseline-only
```

It only starts `common777` + `secrets` — it does **not** log into Discord, load plugins, or start the HTTP server.

Updates are driven by **semver tags** (`vX.Y.Z`):

| Change | Behaviour |
|---|---|
| Major (`X`) | Always allowed when updater is on |
| Minor (`Y`) | Always allowed when updater is on |
| Patch (`Z`) | Allowed **only** when `DevBuilds=true` |

SafeUpdate compares local files to a **baseline** (Blake2b-512 hashes written after the last successful update), never to the newest remote tree. Plugins under `src/plugins/` and `plugins/` follow a manifest `id` decision tree and are never blindly overwritten.

---

### `AutoUpdater`

Master switch for automatic / CLI-driven updates.

| | |
|---|---|
| **Required** | No |
| **Default** | `true` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low — disabling only stops the updater; the bot itself is unaffected |
| **Recommended Action** | Leave `true` if you want CLI/`npm run updater` and any future background checks to work. Set `false` on machines that must never pull remote code. |

```env
AutoUpdater=true
```

---

### `RepositoryUrl`

Highest-priority repository identifier. Accepts `owner/repo` or a full GitHub URL.

| | |
|---|---|
| **Required** | No |
| **Default** | *(empty — falls back to `UpdaterDefaultRepo`)* |
| **Safe to Change** | Yes |
| **Breaking Risk** | Medium — if this is set and the request fails (404, auth, network), the updater **aborts with a warning and does nothing**. It will not fall back to the default repo. |
| **Recommended Action** | Leave empty to use the official default. Set only when tracking a fork or private mirror. |

```env
# RepositoryUrl=lunedusk/NovaX
# RepositoryUrl=https://github.com/lunedusk/NovaX
```

---

### `GithubPat`

Optional GitHub Personal Access Token (or fine-grained token) for private repos or higher API rate limits.

| | |
|---|---|
| **Required** | No (required only for private repositories) |
| **Default** | *(none)* |
| **Safe to Change** | Yes |
| **Breaking Risk** | **HIGH if leaked** — a token with `repo` scope can read private code |
| **Recommended Action** | Set only when needed. Prefer a fine-grained token limited to the target repository. Never commit it. Also accepted as `GH_TOKEN` for compatibility. |

```env
# GithubPat=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

### `UpdaterDefaultRepo`

Fallback repository when `RepositoryUrl` is absent.

| | |
|---|---|
| **Required** | No |
| **Default** | `lunedusk/NovaX` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low |
| **Recommended Action** | Leave at default unless you permanently track a different public repo. |

```env
UpdaterDefaultRepo=lunedusk/NovaX
```

---

### `UpdaterBranch`

Secondary reference branch name (used only as a hint where tags are absent or for future extensions). Tag selection remains the primary update driver.

| | |
|---|---|
| **Required** | No |
| **Default** | `main` |
| **Safe to Change** | Yes |
| **Breaking Risk** | None for current tag-based flow |
| **Recommended Action** | Leave as `main` unless your default branch differs. |

```env
UpdaterBranch=main
```

---

### `DevBuilds`

Allows **patch** tag upgrades (`v1.2.3` → `v1.2.4`). Major and minor upgrades are always allowed when the updater is on.

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low — enabling only accepts more tags; it does not force an update by itself |
| **Recommended Action** | Keep `false` in production. Set `true` on staging or when you intentionally want every patch release. |

```env
DevBuilds=false
```

---

### `SafeUpdate`

When `true`, the updater refuses to apply a new tag if any managed local file differs from the last written baseline (content hash mismatch).

| | |
|---|---|
| **Required** | No |
| **Default** | `true` |
| **Safe to Change** | Yes |
| **Breaking Risk** | **HIGH if disabled carelessly** — local edits can be overwritten |
| **Recommended Action** | Leave `true`. Use `--force` or `UpdaterAllowForce=true` only when you intentionally discard local changes to managed files. |

Files never present in any baseline, and plugins marked “leave alone”, are not treated as dirty.

```env
SafeUpdate=true
```

---

### `UpdaterKeepExtra`

Preserve local files and directories that do not exist on the remote tree (top-level extras, unknown folders, etc.).

| | |
|---|---|
| **Required** | No |
| **Default** | `true` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Medium if set to `false` — extras may be ignored in planning (updater still does not delete arbitrary trees by default, but keep `true`) |
| **Recommended Action** | Leave `true`. |

```env
UpdaterKeepExtra=true
```

---

### `UpdaterAllowForce`

Allows overriding SafeUpdate via config (in addition to the CLI `--force` flag).

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes |
| **Breaking Risk** | **HIGH** — enables overwriting user-modified managed files |
| **Recommended Action** | Leave `false`. Prefer one-off `--force` on the CLI when needed. |

```env
UpdaterAllowForce=false
```

---

### `UpdaterDryRun`

Plan-only mode: resolve tags, run safety checks, print the plan, write nothing.

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes |
| **Breaking Risk** | None |
| **Recommended Action** | Use via CLI `--dry-run` for one-off checks. Set `true` in env only if you want every updater invocation to be non-mutating. |

```env
UpdaterDryRun=false
```

---

### `UpdaterMaxBackups`

How many successful pre-update backups to retain under `.data/updater/backups/`.

| | |
|---|---|
| **Required** | No |
| **Default** | `3` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low — lowering only reduces older backups |
| **Recommended Action** | `3` is enough for most hosts. Increase on machines with spare disk if you want a longer rollback window. |

```env
UpdaterMaxBackups=3
```

---

### `UpdaterTimeoutMs`

Overall timeout (milliseconds) for the update pipeline, including download and `npm run build`.

| | |
|---|---|
| **Required** | No |
| **Default** | `300000` (5 minutes) |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low — too low may abort large builds; too high only delays failure detection |
| **Recommended Action** | Raise on slow CI or large trees; `300000` is fine for typical installs. |

```env
UpdaterTimeoutMs=300000
```

---

### `UpdaterPostUpdateCmd`

Optional shell command run after a successful apply + rebuild (e.g. migrate, notify).

| | |
|---|---|
| **Required** | No |
| **Default** | *(empty — skipped)* |
| **Safe to Change** | Yes |
| **Breaking Risk** | Medium — a failing or destructive command runs with the bot process privileges |
| **Recommended Action** | Leave empty unless you have a specific post-update step. Prefer idempotent scripts. |

```env
# UpdaterPostUpdateCmd=node scripts/post-update.js
```

---

### `UpdaterNotifyChannel`

Optional Discord channel Snowflake for future/post-update notifications (only meaningful when the bot is already running; the standalone updater path does not log in).

| | |
|---|---|
| **Required** | No |
| **Default** | *(empty)* |
| **Safe to Change** | Yes |
| **Breaking Risk** | None |
| **Recommended Action** | Leave empty until notification wiring is used in your deployment. |

```env
# UpdaterNotifyChannel=123456789012345678
```

---

### `UpdaterPluginManifest`

Filename used inside each plugin folder for identity checks during updates.

| | |
|---|---|
| **Required** | No |
| **Default** | `manifest.json` |
| **Safe to Change** | Only if all your plugins use a different name |
| **Breaking Risk** | Medium — wrong name disables id matching and changes plugin update decisions |
| **Recommended Action** | Leave as `manifest.json`. |

```env
UpdaterPluginManifest=manifest.json
```

---

### `UpdaterMode`

How the updater is intended to run.

| | |
|---|---|
| **Required** | No |
| **Default** | `standalone` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low |
| **Recommended Action** | Keep `standalone` for `npm run updater`. Use `background` only if you later wire periodic checks inside a long-running process. |

**Accepted values:** `standalone`, `background`

```env
UpdaterMode=standalone
```

---

### CLI flags (not env, but related)

| Flag | Effect |
|---|---|
| `--updater` | Enter updater-only mode (no Discord login) |
| `--dry-run` / `--dryRun` | Plan only |
| `--force` | Bypass SafeUpdate for this run |
| `--baseline-only` / `--baselineOnly` | Find exact or nearest tag, hash-match local files, write baseline; non-matching files are treated as user-updated and excluded from the baseline. No file overwrite. |

---

### First run / missing baseline

If `.data/updater/baseline.json` is missing or unreadable:

- Normal update path may still select the newest **allowed** tag, apply, rebuild, then write a new baseline.
- `--baseline-only` selects the exact or nearest tag relative to the current baseline tag or `package.json` version, compares hashes, and writes a baseline from matching files only.
```

---

## 14. Authentication & Tokens

### `TokenMasterSecret`

The master secret used to derive per-user HMAC-SHA256 signing keys for bearer tokens issued by the Token Manager. All token signatures depend on this value — changing it invalidates every existing token instantly.

| | |
|---|---|
| **Required** | **Yes — if the `token` plugin is loaded** |
| **Default** | *(none — the token handler will refuse to initialize without it)* |
| **Safe to Change** | Only with full token revocation first |
| **Breaking Risk** | **CRITICAL** — changing this value silently invalidates all active tokens. Users with existing tokens will receive `INVALID_SIGNATURE` errors and must re-authenticate. There is no migration path — old tokens cannot be verified against a new secret. |
| **Recommended Action** | Generate a strong random string of at least 32 characters and set it once. Treat it like a database password — persistent across restarts, never committed to source control. To rotate, first call `revokeAll` for each active user via the API, then swap the secret and restart. |

Generate a secure value:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```env
TokenMasterSecret=k7Bz9xQ2mR4nW8pL1vY6dF3hJ5tA0uC9wE2sG4kM7bN1xR8qT6yP3
```

> 🔒 **Security Notice:** This secret is the root of trust for your entire token authentication system. Anyone with this value can forge valid tokens for any user with any permission bits. Store it in a secrets vault or a protected `.env` file, never in source control or a client-accessible config.

---

### `TokenTTL`

The default time-to-live (in seconds) for newly issued tokens. After this duration, the token expires and the client must refresh or re-authenticate.

| | |
|---|---|
| **Required** | No |
| **Default** | `900` (15 minutes) |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Low — only affects newly issued tokens; existing tokens keep their original expiry |
| **Recommended Action** | 900 seconds (15 minutes) is a good balance between security and UX. Increase for low-risk dashboards; decrease for sensitive admin panels. |

```env
TokenTTL=900
```

---

### `TokenMaxTTL`

The absolute maximum TTL (in seconds) that can be requested when issuing a token. Even if a caller requests a longer TTL via the API, the Token Manager clamps it to this value.

| | |
|---|---|
| **Required** | No |
| **Default** | `86400` (24 hours) |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | None |
| **Recommended Action** | Leave at 24 hours unless you have a specific reason to allow longer-lived tokens. Longer tokens mean longer windows of exposure if a token is stolen. |

```env
TokenMaxTTL=86400
```

---

### `TokenIssuer`

The `iss` (issuer) claim embedded in every token. On verification, the Token Manager rejects tokens whose issuer doesn't match this value. Useful for distinguishing tokens from different environments (staging vs production).

| | |
|---|---|
| **Required** | No |
| **Default** | `novax` |
| **Safe to Change** | Yes — but invalidates all existing tokens (they'll fail the issuer check) |
| **Breaking Risk** | Medium — changing this is effectively a soft revocation of all tokens |
| **Recommended Action** | Leave as `novax` unless you run multiple NovaX instances and need to prevent tokens from one environment being used in another. |

```env
TokenIssuer=novax
```

---

### `TokenAudience`

The `aud` (audience) claim embedded in every token. On verification, the Token Manager rejects tokens whose audience doesn't match. Used to scope tokens to a specific consumer (e.g. `dashboard`, `mobile`, `api`).

| | |
|---|---|
| **Required** | No |
| **Default** | `dashboard` |
| **Safe to Change** | Yes — but invalidates all existing tokens (they'll fail the audience check) |
| **Breaking Risk** | Medium — same as `TokenIssuer` |
| **Recommended Action** | Leave as `dashboard` for single-audience setups. If you have multiple clients consuming tokens, consider issuing tokens with different audiences per client via the API's `TokenIssueOptions`. |

```env
TokenAudience=dashboard
```

---

## 15. Full `.env` Template

Copy this template as your starting point. Required variables are marked. All others have safe defaults.

```env
# ============================================================
# NovaX — Environment Configuration
# ============================================================

# ── RUNTIME ─────────────────────────────────────────────────
NODE_ENV=production
BotName=MyBot

# ── BOT OWNERS ─────────────────────────────────────────────
# Comma-separated Discord user IDs with full admin bypass
# BotOwnerIds=123456789012345678

# ── DISCORD ─────────────────────────────────────────────────
# REQUIRED
DiscordToken=your_bot_token_here

# Optional: restrict to specific intents (leave blank for defaults)
# DiscordIntents=Guilds,GuildMessages,MessageContent,GuildMembers

# Optional: guild-scope command sync (use during development only)
# GuildID=123456789012345678

# Optional: enable sharding for 2500+ server bots
isSharded=false

# ── LOGGING ─────────────────────────────────────────────────
LogLevel=info
LogTZ=UTC

# ── HTTP API ─────────────────────────────────────────────────
APIPort=3000

# ── DATABASE ─────────────────────────────────────────────────
# JSON object: alias -> { uri, engine, poolSize?, maxRetries? }
# Leave blank to auto-provision a local NovaDB instance named "main"
Database={"main": {"uri": "novadb://local", "engine": "native-novadb"}}

# Set to true ONLY if you have manually defined a "main" database above
# and explicitly do not want the automatic fallback
DisableDefaultNovaDB=false

# Set to true ONLY if you have manually defined a "main" SQLite database
# and do not want the automatic fallback
DisableDefaultSqlite=false

# ── PLUGIN INTEGRITY ────────────────────────────────────────
# Default is the Lunedusk developer key — leave unchanged to run official plugins
PublicKey=MCowBQYDK2VwAyEAxGjGVv/sK86Px3N7hLY1x1QxS5bugvrqPlo8MW95BwQ=

# Only set on build machines — never on production servers
# PrivateKey=your_ed25519_private_key_base64

# WARNING: enabling this bypasses plugin signature verification globally
allowUnCertifiedPlugins=false

# Granular bypass for specific plugins in development
# whitelistedPlugins=my-dev-plugin

# ── INTERNATIONALISATION ────────────────────────────────────
DefaultLocale=en

# ── RATE LIMITING ───────────────────────────────────────────
EnableGlobalRatelimit=true

# ── HOT RELOAD ──────────────────────────────────────────────
hotReloadEnabled=false

# ── AUTHENTICATION & TOKENS ────────────────────────────────
# REQUIRED if API gateway env mode is enabled — must be kept secret
# ApiKey=your_gateway_master_key_here

# REQUIRED if using the token plugin — must be 32+ characters, persistent
# TokenMasterSecret=your_generated_secret_here

# Token TTL in seconds (default: 900 = 15 minutes)
# TokenTTL=900

# Max TTL cap in seconds (default: 86400 = 24 hours)
# TokenMaxTTL=86400

# Issuer and audience claims (change only if running multiple environments)
# TokenIssuer=novax
# TokenAudience=dashboard

# ── AUTO UPDATER ────────────────────────────────────────────
AutoUpdater=true
# RepositoryUrl=                    # if set and fails → abort (no fallback)
# GithubPat=                        # private repos / higher rate limits
UpdaterDefaultRepo=lunedusk/NovaX
UpdaterBranch=main
DevBuilds=false
SafeUpdate=true
UpdaterKeepExtra=true
UpdaterAllowForce=false
UpdaterDryRun=false
UpdaterMaxBackups=3
UpdaterTimeoutMs=300000
# UpdaterPostUpdateCmd=
# UpdaterNotifyChannel=
UpdaterPluginManifest=manifest.json
UpdaterMode=standalone
```

---

## 16. Quick-Reference Table

| Variable | Required | Default | Safe to Change | Breaking Risk |
|---|---|---|---|---|
| `NODE_ENV` | No | `production` | Yes | Low |
| `BotName` | No | *(none)* | Yes | None |
| `BotOwnerIds` | No | *(empty)* | Yes | **High** |
| `DiscordToken` | **YES** | *(none)* | Yes | Critical if leaked |
| `DiscordIntents` | No | All unprivileged (warns if unset) | Yes | Medium |
| `GuildID` | No | *(global sync)* | Yes | Low |
| `isSharded` | No | `false` | Yes | Medium |
| `LogLevel` | No | `info` / `debug` | Yes | None |
| `LogTZ` | No | `UTC` | Yes | None |
| `APIPort` | No | `3000` | Yes | Low |
| `ApiKey` | If API gateway env mode is enabled | *(none)* | Yes | **Critical** |
| `Database` | No | `{}` + auto NovaDB | Yes | **High** |
| `DisableDefaultNovaDB` | No | `false` | Yes | **High** |
| `DisableDefaultSqlite` | No | `false` | Yes | **High** |
| `PublicKey` | No | Lunedusk dev key | Only with `PrivateKey` | **High** |
| `PrivateKey` | No | *(none)* | Only with `PublicKey` | Critical — keep secret |
| `allowUnCertifiedPlugins` | No | `false` | Yes | Security risk |
| `whitelistedPlugins` | No | *(empty)* | Yes | Medium security risk |
| `DefaultLocale` | No | `en` | Yes | Low |
| `EnableGlobalRatelimit` | No | `true` | Yes | Low |
| `hotReloadEnabled` | No | `false` | Yes | Low |
| `TokenMasterSecret` | If token plugin loaded | *(none)* | Only with revocation | **Critical** |
| `TokenTTL` | No | `900` | Yes | Low |
| `TokenMaxTTL` | No | `86400` | Yes | None |
| `TokenIssuer` | No | `novax` | Yes (invalidates tokens) | Medium |
| `TokenAudience` | No | `dashboard` | Yes (invalidates tokens) | Medium |
| `AutoUpdater` | No | `true` | Yes | Low |
| `RepositoryUrl` | No | *(empty)* | Yes | Medium (fail = abort) |
| `GithubPat` | No* | *(none)* | Yes | **Critical if leaked** |
| `UpdaterDefaultRepo` | No | `lunedusk/NovaX` | Yes | Low |
| `UpdaterBranch` | No | `main` | Yes | None |
| `DevBuilds` | No | `false` | Yes | Low |
| `SafeUpdate` | No | `true` | Yes | **High if disabled** |
| `UpdaterKeepExtra` | No | `true` | Yes | Medium if `false` |
| `UpdaterAllowForce` | No | `false` | Yes | **High** |
| `UpdaterDryRun` | No | `false` | Yes | None |
| `UpdaterMaxBackups` | No | `3` | Yes | Low |
| `UpdaterTimeoutMs` | No | `300000` | Yes | Low |
| `UpdaterPostUpdateCmd` | No | *(empty)* | Yes | Medium |
| `UpdaterNotifyChannel` | No | *(empty)* | Yes | None |
| `UpdaterPluginManifest` | No | `manifest.json` | Rarely | Medium |
| `UpdaterMode` | No | `standalone` | Yes | Low |

\*Required only for private GitHub repositories.

### `common.json` Field Reference

All standard env variables above are also valid as top-level keys in `common.json`. Additional fields specific to `common.json`:

| Field | Required | Description |
|---|---|---|
| `__info__.__author__` | **YES** | Must be exactly `"Lunedusk"` — framework exits on mismatch |
| `__info__.version` | No | Always overwritten by `package.json` version at boot |
| `ENVSettings` | No | `true` = respect existing env; `false` = inject all fields into `process.env`; absent = no injection |
| `TZ` | No | Timezone shorthand in `common.json` — equivalent to `LogTZ` when injected into env |

---

*For plugin development documentation, database API reference, or the full IHeart context API, refer to the corresponding framework documentation files.*