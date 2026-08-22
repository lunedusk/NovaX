# 🌌 Project NovaX Enterprise Framework (v0.2.0)

NovaX is a corporate-grade, highly optimized, completely modular application platform engineered in TypeScript on a strict ECMAScript Module (ESM) architecture. Built to support high-throughput, fault-tolerant Discord application infrastructures, NovaX features automated plugin workspace dependency sandboxing, cryptographic code-integrity and anti-tamper audits, a performance-tuned polyglot storage abstraction router, and an immutable context-injected dependency broker (`IHeart`) that eliminates global singletons while maintaining performance profiles.

---

## Documentation

| Doc | Audience |
|-----|----------|
| [SETUP.md](SETUP.md) | Install, env, first run |
| [PLACEHOLDERS.md](PLACEHOLDERS.md) | Placeholder system (full) |
| [LOADER.md](LOADER.md) | Config/lang merge + surgical JSON5 write |
| [UPDATER.md](UPDATER.md) | Crash-safe updater (CLI / background) |
| [AUDIT.md](AUDIT.md) | Audit registry |
| [ERRORS.md](ERRORS.md) | Error registry + NovaError |
| [CACHE.md](CACHE.md) | Cache façade + TTLCache registry |
| [System Prompt - AI - Plugin.md](System%20Prompt%20-%20AI%20-%20Plugin.md) | Plugin authoring contract |
| [ENV Reference.md](ENV%20Reference.md) | Environment variables |
| [Database.md](Database.md) | Database configuration |
| [NovaDB.md](NovaDB.md) | NovaDB |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributing |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Code of conduct |

---

## License
NovaX is licensed under the **PolyForm Noncommercial License 1.0.0**. This means you are free to use and modify the framework for personal and non-commercial purposes, but you cannot sell it, claim it as your own, or use it for commercial gain without written permission.

**Note on Plugins:** Any independent plugins, commands, or extensions you create using the NovaX framework remain your intellectual property. You retain full ownership of your original plugin code.

---

## 🏛️ System Architecture & Framework Lifecycle

NovaX operates an multi-stage bootstrap pipeline designed to enforce thread isolation, establish cryptographic code validation checkpoints, provision persistence structures, and map localized state systems:

```
[1. Identity Security Lock] ──> [2. Polyglot Storage Broker] ──> [3. Directed Graph Sorting]
│
[6. Command & Gateway Sync] <── [5. Subsystem Loader Engine] <── [4. Sandbox Workspace Isolate]
```

1. **Process Lockdown & Identity Verification (`Common777`)**: The engine locks the immutable process script entry-point path (`process.argv[1]`) immediately upon launch. Any mid-execution attempt to divert pathways results in immediate termination (`process.exit(1)`). It processes `common.json`, asserts that the global development author field evaluates precisely to `"Lunedusk"`, and merges definitions into `process.env` boundaries.
2. **Polyglot Storage Broker (`DatabaseManager`)**: Parses a single serialized JSON object from `process.env.Database`. It instantiates independent connection pools for Native PostgreSQL clients, write-ahead logged (WAL) SQLite runtimes, sharded ioredis clustering triads (Main, Pub, and Sub clients for native pub/sub streaming out of the box), MongoDB nodes, or global multi-dialect TypeORM connections—managed by automated exponential backoff reconnect layers capped at 10-second intervals. Framework data planes (permissions, tokens, guild-gate) sit on a **shared backend selector** (preference sqlite → postgres → mongo, overridable per subsystem via config/env). **Schema migrations** run at boot after connect and before plugins. The **API gateway** authorizes `/api/*` with bearer API keys and a typed `httpRoutes` bit policy (`bitsMode` all|any).
3. **Topological Dependency Graphing**: Scans all subdirectories inside `/plugins/`. It maps plugin dependencies as a strict directed acyclic graph (DAG), running depth-first search (DFS) sorting sweeps to establish proper load sequences and instantly catch circular dependency locks.
4. **Sandboxed Module Isolation**: Each plugin executes inside an isolated workspace directory container. NovaX fires a separate child thread execution to install local plugin `package.json` requirements with optimization flags (`--no-save`, `--prefer-offline`) to maintain parent environment cleanliness. A tailored Node.js ESM module resolution hook intercepts and routes import calls to the plugin's local `node_modules` sandbox structure before falling back to the parent environment scope.
5. **Subsystem Loader Engine**:
   - **`ConfigLoader` & `LangLoader`**: Synchronizes, maps, and cleans JSON5 structured sheets into centralized application directories. They use a shared **merge-preserve** engine (add missing defaults; keep user keys/values; no prune/type-reset) and **surgical JSON5** writes with parse/deep-equal round-trip (wholesale only as fallback).
   - **`CommandLoader` / `EventLoader` / `RouteLoader`**: Automatically registers all code logic extending abstract system bases. It maps application slash syntax, hooks Express endpoint namespaces, and registers element mappings (buttons, modals, drop-downs) directly into a master handler registry.
   - **`EmojiLoader`**: Automatically aggregates local graphical resources (`data/emoji/`) and map collections (`data/emoji.json`), distributing synced instances into a global sheet file (`.data/emojis.json`).
6. **Command Sync & Gateway Connection**: Validates shard contexts, connects to the Discord gateway, synchronizes command bindings across specified test guilds or international scopes, and sets verified plugins to a live `ENABLED` operational status.

---

## Client Auto-Updater (summary)

NovaX can update a deployed instance without a local git checkout:

- **Core:** GitHub tags `vX.Y.Z` on the configured repository (major/minor always;
  patch only if `DevBuilds=true`).
- **First-party plugins:** Names from the **core tag’s** `plugins.txt`; each is
  resolved via tags `plugin-<name>-v*` only (no branch-tip fallback). Compatibility
  uses the plugin manifest’s `novax_version` / `engines.novax`.
- **SafeUpdate:** Compares local files to a baseline (Blake2b-512). Dirty **core**
  files block the core update; dirty **plugin** trees skip that plugin only.
- **Apply:** Core files come from the core tag archive; each updated plugin folder
  is fully replaced from its plugin tag. Runtime config under `configuration/` and
  state under `.data/` are not part of the update payload.
- **CLI (post-build):** `npm run updater`  
  Flags: `--dry-run`, `--force`, `--baseline-only`, `--install-plugin <id>`.

Full write-up: [UPDATER.md](UPDATER.md). Variable reference: [ENV Reference.md](ENV%20Reference.md) → **Auto Updater**.

---

## 📂 Project Directory Layout

NovaX distinguishes clearly between **source / development**, **build output**, and **runtime state**.  
The production Docker image and the auto-updater only ship / replace the build artefacts.

### Development / Source tree (what you work in)
```
NovaX/
├── .data/                          # Runtime cache & state (generated, never commit)
├── configuration/                  # Synced runtime configs (generated / user-edited)
│   └── lang/
├── core/                           # Compiled framework output (tsc — do not edit)
├── docs/                           # Generated TypeDoc (npm run docs)
├── logs/                           # Rotating session logs (runtime)
├── pterodactyl-eggs/               # Deployment egg
├── plugins/                        # Runtime plugin workspaces (built/copied here)
│   └── <plugin_id>/                # kebab-case, must match manifest.id
│       ├── index.ts                # REQUIRED — extends BasePlugin
│       ├── manifest.json           # REQUIRED — identity + novax_version
│       ├── manifest.nvx            # Optional signed manifest
│       ├── package.json            # Only if the plugin has external deps
│       ├── src/
│       │   ├── commands/
│       │   ├── events/
│       │   ├── routes/
│       │   └── handlers/
│       └── data/
│           ├── configuration/
│           │   ├── config.json5
│           │   └── lang/
│           ├── schema/             # config + lang Zod schemas
│           ├── rules/              # config + lang validation rules
│           ├── emoji/
│           └── emoji.json
├── scripts/                        # Utility scripts
├── src/                            # Framework source (TypeScript) — not shipped in prod images
│   ├── index.ts
│   ├── database/                   # NovaDB engine
│   ├── core/
│   │   ├── audit/
│   │   ├── errors/
│   │   ├── error/
│   │   ├── bases/
│   │   ├── bootstrap/
│   │   ├── builders/
│   │   ├── database/
│   │   │   └── migrations/core/
│   │   ├── decorators/
│   │   ├── dependency/
│   │   ├── flatbuffer/
│   │   ├── heart/
│   │   ├── helpers/
│   │   ├── internal/
│   │   ├── loader/
│   │   ├── manager/
│   │   │   └── updater/
│   │   ├── placeholder/
│   │   ├── scheduler/
│   │   ├── types/
│   │   ├── utils/
│   │   ├── validation/
│   │   └── watcher/
│   └── plugins/                    # First-party plugin source
│       ├── api/
│       ├── core/
│       ├── permissions/
│       └── token/
├── common.json
├── package.json
├── plugins.txt                     # First-party plugin list (auto-updater)
├── tsconfig.json
├── typedoc.json
├── Dockerfile
├── docker-compose.yml
├── .env / .env.example
├── sync.sh  sync-core.sh
├── takebacks.json  takebacks.example.json
├── README.md  SETUP.md  PLACEHOLDERS.md
├── LOADER.md  UPDATER.md  AUDIT.md  ERRORS.md  CACHE.md          # [new]
├── ENV Reference.md  Database.md  NovaDB.md
├── System Prompt - AI - Plugin.md
├── CONTRIBUTING.md  CONTRIBUTORS.md  CODE_OF_CONDUCT.md
└── LICENSE
```

### Built / Production tree (what the Docker image and updater actually contain)
```
NovaX/                              # (or /app inside the container)
├── .data/                          # Runtime only – volume-mount
├── configuration/                  # Runtime only – volume-mount
├── core/                           # Compiled framework (from `npm run build`)
├── logs/                           # Runtime only – volume-mount
├── plugins/                        # Runtime plugin folders (volume or baked)
├── scripts/                        # Present only if the build pipeline copies it
├── common.json
├── index.js
├── index.d.ts                      # optional
├── package.json
├── plugins.txt                     # Required by the auto-updater
└── node_modules/                   # Production dependencies only (`npm ci --omit=dev`)
```

**Important notes**
- `src/` is **source-only**. It is never shipped in a production image and may be absent after a clean build / updater run.
- `core/` is pure compiled output. Do not document or edit its internal structure.
- `plugins.txt` lives at the root and is the authoritative list of first-party plugins the updater will install/update.
- Runtime directories (`.data/`, `configuration/`, `logs/`) must be volume-mounted; they are never part of the update payload.
- Plugin updates **replace the entire plugin directory** (SafeUpdate respects dirty files unless `--force` is used).

---

## 🧬 Scoped Injection Engine: `IHeart`

Components do not reference open singletons or unverified framework imports. Instead, every execution layer is injected with an immutable, frozen dependency manager context instance named `IHeart`. This proxy structure segments access across six operational domains:

### 1. `this.heart.assets`

- **`config` (`configManager`)**: Safely fetches synchronized settings mapped from `.json5` fields.
- **`lang` (`i18n`)**: Resolves multi-language international translation entries, running automated lookup fallbacks: Target Locale → Base Language → Default Master Locale → English (`'en'`).
- **`emoji` (`emojis`)**: Parses and cleans custom injected emojis using a localized matching regular expression.
- **`secrets` (`secrets`)**: Grants access to encrypted runtime variables from an append-only, AES-256-GCM hardware-encrypted memory vault.

### 2. `this.heart.db`

- **`mongo`**: Interface for multi-connection Mongoose database instance configurations.
- **`redis`**: Accesses clustered Redis triads (`main`, `pub`, `sub`) powered by `ioredis`.
- **`postgres`**: Direct client-pooling query maps interacting with native PostgreSQL instances.
- **`sqlite`**: Optimized `better-sqlite3` instance supporting Write-Ahead Logging (WAL) and memory-backed cache tables.
- **`orm`**: Initialized TypeORM data-sources mapped safely for production environments (`synchronize: !isProd`).

### 3. `this.heart.discord`

- **`interactions` (`interactionRegistry`)**: Master repository containing exact or pattern-matched memory entries across six interaction pathways (`chat`, `context`, `autocomplete`, `button`, `select`, `modal`).

### 4. `this.heart.net`

- **`http` (`httpServer`)**: Mounts custom routers onto the centralized framework Express application server instance.
- **`metrics` (`metricsManager`)**: Access point to feed counter stats or histogram execution metrics into Prometheus monitoring layers.

### 5. `this.heart.system`

- **`events` (`eventBus`)**: Advanced asynchronous event messaging core supporting priority arrays and wildcard evaluations.
- **`scheduler` (`scheduler`)**: Dynamically persists interval or cron-based tasks utilizing atomic state file swaps.
- **`cooldowns` (`CooldownManager`)**: Routes token-bucket user request restrictions, targeting Redis cluster layers first before utilizing local fallback structures.

### 6. `this.heart.toolbox`

- **`data.codec`**: Fallback-safe serialization registry supporting standard `json`, compiled message pack (`msgpack`), or compact CBOR encoding patterns.
- **`data.Cache`**: Memory-bounded `TTLCache` mapping entry limits (`maxSize`) with background interval eviction passes.
- **`data.BloomFilter`**: Space-efficient double-hashed (`crypto` MD5 digests) set structure for high-speed value check routines.
- **`security.SecureVault`**: Splits data streams into chunk blocks, applying AES-GCM and Brotli compression layers.
- **`security.HybridVault`**: Provides asymmetric encryption structures leveraging X25519 elliptic curves and SHA-256 HKDF mappings.

---

## 🛠️ Configuration & Assets Blueprint

To achieve seamless, fault-tolerant plugin execution, asset structures must align precisely with NovaX's configuration synchronization specifications:

### 1. Default Option Parameters (`data/configuration/config.json5`)

Stored in the plugin's local namespace folder. Supports JSON5 formatting to include code commenting out of the box:

```json5
{
  // Structural control options for the automated filter
  security: {
    enforceStrictCheck: true,
    alertChannelId: "120044556677889900"
  },
  thresholds: {
    maxViolationCount: 3,
    mitigationActions: ["warn", "timeout", "kick"]
  }
}
```

### 2. Localization Dictionaries (`data/configuration/lang/en-US.json5`)

Internationalization variables support localized parameter injections wrapped inside double brackets (`{{var}}`):

```json5
{
  protection: {
    action_broadcast: "🌌 %%emoji_shield_icon%% Member **{{user}}** was penalized. Reason: *{{context}}*",
    rate_limited_notice: "⚠️ Action locked. Please wait **{{time}}** remaining seconds."
  }
}
```

### 3. Visual Assets Registry (`data/emoji.json`)

Maps static asset tags or remote links. The framework parses, uploads, and caches these structures into a centralized map sheet file on initialization:

```json
{
  "shield_icon": "https://cdn.novax-framework.internal/assets/shield.png",
  "checkmark_icon": "https://cdn.novax-framework.internal/assets/check.png"
}
```

### 4. Variable Interpolation vs. Global Placeholders

NovaX bifurcates text cleaning operations into two explicit processing vectors:

- **Variable Interpolation (`{{key}}`)**: Evaluated contextually per call by passing a local data dictionary object into a builder layout. It natively parses nested object structures using standard dot notation (e.g., `{{member.profile.avatar}}`).
- **Global Placeholders (`%%key%%`)**: Replaces constant elements application-wide. NovaX expands items from the core layout configuration's `placeholders` entry, combined with entries stored inside the global `EmojiManager` prefixed with `emoji_`. This allows any layout asset to reference cached emojis globally via the notation `%%emoji_shield_icon%%`.

---

## 🎛️ Architecture Base Implementations

Plugins write core logic by matching default exports against framework abstract bases. All module files must end with strict extensions (`.js` or `.mts`).

### 1. Slash Application Commands (`BaseCommand`)

Expose an executable slash interaction within `src/commands/`. Extends `BaseCommand` and maps a type-safe `CommandConfig` metadata structure to execute pre-flight authorization sweeps:

```typescript
import { BaseCommand, type CommandConfig } from '#core/bases/Command.js';
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

export default class SecurityBanAction extends BaseCommand {
    // 1. Declare slash command builder definitions
    public readonly data = new SlashCommandBuilder()
        .setName('ban_user')
        .setDescription('Permanently terminates a member profile context access across the active guild.')
        .addUserOption(opt => opt.setName('target').setDescription('Target member profile').setRequired(true))
        .addStringOption(opt => opt.setName('rationale').setDescription('Contextual reasoning text').setRequired(false));

    // 2. Enforce strict pre-flight gatekeeping rules
    public readonly config: CommandConfig = {
        cooldown: 10,                        // Enforces a rate-limiting bucket constraint
        devOnly: false,                      // Locks command execution exclusively to master developer accounts
        permissionLevel: 'Administrator',    // Evaluates custom permissions mapped inside the system rule table
        userPermissions: ['BanMembers'],     // Validates initiating member's Discord API keys
        clientPermissions: ['BanMembers'],   // Asserts that the client application holds necessary rights
        allowInDm: false,                    // Disallows execution within direct messaging contexts
        autoDefer: 'ephemeral'               // Issues an automatic private defer state acknowledgement
    };

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const targetMember = interaction.options.getUser('target', true);
        const reasonStr = interaction.options.getString('rationale') ?? 'No context provided.';

        // Perform administrative state mutation operations here...

        // Shorthand localization handled via the assets language registry
        const promptResponse = this.t('protection.action_broadcast', {
            user: targetMember.username,
            context: reasonStr
        });

        await interaction.editReply({ content: promptResponse });
    }
}
```

### 2. State Observers & Inline Element Mapping (`BaseEvent`)

Events placed inside `src/events/` monitor gateway traffic ticks. They use internal `Map` mappings to route interactive components (buttons, modal views, select dropdowns) directly inside the file:

```typescript
import { BaseEvent } from '#core/bases/Event.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';

export default class LifecycleInteractionObserver extends BaseEvent {
    public readonly name = 'interactionCreate'; // Target EventBus matching entry key
    public readonly once = false;

    // Registers element schemas instantly into the master interaction registry
    public buttons = new Map([
        // Route exact match identifiers instantly
        ['security_audit_approve', async (interaction: ButtonInteraction) => {
            await interaction.reply({ content: 'Cryptographic authorization registered.', ephemeral: true });
        }],
        // Extract inner custom string arguments utilizing regular expressions
        [/^infraction_pardon_(\d+)$/, async (interaction: ButtonInteraction, match?: RegExpMatchArray) => {
            const caseId = match?.[1];
            await interaction.reply({ content: `Initiating processing rollback on case record: ${caseId}`, ephemeral: true });
        }]
    ]);

    public modals = new Map([
        ['incident_report_form', async (interaction: ModalSubmitInteraction) => {
            await interaction.reply({ content: 'Transmission logged for security review.', ephemeral: true });
        }]
    ]);

    public async execute(interaction: any): Promise<void> {
        this.heart.log.debug(`Observer pattern handling execution frame: ${interaction.id}`);
    }
}
```

### 3. REST API Interface Routers (`BaseRoute`)

Routes managed under `src/routes/` open standard endpoint pathways tied directly to the core application Express server instance:

```typescript
import { BaseRoute } from '#core/bases/Route.js';
import type { Request, type Response } from 'express';

export default class MetricCollectorEndpoint extends BaseRoute {
    public readonly basePath = '/metrics/ingest'; // Mounted path namespace prefix

    protected register(): void {
        // Wrap async route blocks inside an execution handler to catch thread drops
        this.router.post('/submit', this.asyncHandler(this.parseIncomingMetrics.bind(this)));
    }

    private async parseIncomingMetrics(req: Request, res: Response): Promise<void> {
        const dataPayload = req.body;
        this.log.info('Asynchronously parsing tracking telemetries cluster arrays.');
        res.status(202).json({ code: 'ACCEPTED', synced: true });
    }
}
```

### 4. Method Level Declarative Rate Limiting (`@Cooldown`)

Inject standard user rate limits directly onto instance action operations via method decorators:

```typescript
import { Cooldown } from '#core/decorators/cooldown.js';
import type { ChatInputCommandInteraction } from 'discord.js';

export class InventoryInteractionManager {
    // Intercepts call arrays and prints an explicit ephemeral component banner if limited
    @Cooldown('cluster_flush_limit', { limit: 1, windowMs: 45000 })
    public async clearClusterCache(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.reply({ content: 'Purging transient database cache allocations...', ephemeral: true });
    }
}
```

---

## 🎨 Layout Generation: Visual UI Engines

NovaX introduces layout rendering modules. They scan string content data, executing placeholder translations and field variables lookups automatically across structural layouts.

### 1. Generating Rich Context Embeds (`EmbedEngine`)

The `EmbedEngine` automatically reformats loose variables, handles zero-width spaces for icon-only blocks, split arrays overflowing 25 fields across child layouts, and drops extra components if they cross the 6000 character limit:

```typescript
import { EmbedEngine } from '#core/builders/index.js';

const embedLayout = {
    embeds: [{
        title: "🌌 Infrastructure Status: {{nodeId}}",
        description: "Live cluster tracking performance summary statistics:",
        color: "#5865F2",
        timestamp: "now",
        author: {
            iconURL: "https://cdn.novax.internal/logo.png"
        },
        fields: [
            { name: "Active Allocation", value: "{{stats.allocation}}", inline: true },
            { name: "Global Management Ingest", value: "%%placeholder_dashboard_url%%" }
        ]
    }]
};

const payloadView = EmbedEngine.build(embedLayout, {
    variables: { nodeId: "NEXUS-NODE-04", stats: { allocation: "782 MB / 2048 MB" } }
});
```

### 2. High-Performance Component Interactivity (`ComponentEngine`)

Build interactive layouts featuring `container`, `text`, `section`, `separator`, `mediaGallery`, `file`, and all five dropdown component variants (`string`, `channel`, `user`, `role`, `mentionable`). Enabling `autoWrapInteractives: true` lets the engine group loose items into rows of up to 5 elements per tier automatically:

```typescript
import { ComponentEngine } from '#core/builders/index.js';

const interactiveSpec = {
    version: 1,
    components: [{
        type: "container",
        accentColor: "#E74C3C",
        children: [
            { type: "text", content: "### Network Security Center" },
            { type: "separator", divider: true, spacing: "small" },
            { type: "button", label: "Isolate Clusters", style: "danger", customId: "freeze_network" },
            { type: "button", label: "Download Report", style: "secondary", customId: "download_manifest" },
            { type: "selectMenu", kind: "channel", customId: "alert_broadcast_target", placeholder: "Select target broadcast notification log channel..." }
        ]
    }]
};

const finalComponents = ComponentEngine.build(interactiveSpec);
```
