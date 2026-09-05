# NovaDB — Plugin Developer Reference

> Access NovaDB in any Zene plugin via `this.heart.db.nova`

NovaDB is Zene's built-in embedded document store — a full LSM-tree database written in TypeScript that lives on disk alongside your bot. No external server, no Docker container, no connection string gymnastics. Collections are created on demand, documents are stored as MessagePack blobs, and every write is WAL-protected so your data survives crashes.

This document covers every feature exposed through `this.heart.db.nova` with runnable examples you can drop straight into a plugin.

---

## Table of Contents

1. [Getting a Collection](#1-getting-a-collection)
2. [Documents — Shape & Rules](#2-documents--shape--rules)
3. [Inserting & Updating — upsert](#3-inserting--updating--upsert)
4. [Reading — get](#4-reading--get)
5. [Deleting — delete](#5-deleting--delete)
6. [Scanning — scan](#6-scanning--scan)
7. [Transactions](#7-transactions)
8. [Snapshots — Point-in-time Reads](#8-snapshots--point-in-time-reads)
9. [Secondary Indexes — findBy](#9-secondary-indexes--findby)
10. [Replication](#10-replication)
11. [Lifecycle — close](#11-lifecycle--close)
12. [Full Plugin Example](#12-full-plugin-example)
13. [Internals Cheat Sheet](#13-internals-cheat-sheet)

---

## 1. Getting a Collection

```typescript
const users = await this.heart.db.nova.get('main').collection('users');
```

`this.heart.db.nova` is the `NovaRegistry`. You pick an instance by alias (almost always `'main'`, auto-provisioned at startup if not configured), then call `.collection(name)`.

**What happens under the hood:**
- Creates `.data/database/main/users/` on disk if it doesn't exist.
- Replays any unflushed WAL records into an in-memory memtable.
- Registers a background group-commit timer so writes are batched to disk efficiently.

Collections are cached — calling `.collection('users')` ten times returns the same object.

```typescript
// You can have as many collections as you like
const guilds   = await this.heart.db.nova.get('main').collection('guilds');
const warnings = await this.heart.db.nova.get('main').collection('warnings');
const economy  = await this.heart.db.nova.get('main').collection('economy');
```

---

## 2. Documents — Shape & Rules

Every document is a plain TypeScript object that extends `NovaDocument`:

```typescript
interface NovaDocument {
    _id?: string;           // Primary key. Auto-generated (UUID) if omitted.
    __deleted__?: boolean;  // Internal tombstone flag — do not set manually.
    __txnId__?: bigint;     // Internal MVCC version — do not set manually.
    [key: string]: unknown; // Your own fields go here.
}
```

**Rules:**
- `_id` must be a **string** if you supply one. Keep it URL-safe — alphanumeric, hyphens, underscores are all fine.
- Fields prefixed with `__` are reserved for NovaDB internals.
- Values can be anything MessagePack can encode: strings, numbers, booleans, arrays, nested objects, `null`. `undefined` is stripped.
- There is no schema enforcement — add or remove fields freely between writes.

```typescript
// Good document shapes
{ _id: 'user_123456789', username: 'cooldev', xp: 0, roles: ['member'] }
{ _id: `warn_${guildId}_${userId}_${Date.now()}`, reason: 'spamming', moderatorId: '987' }
{ /* no _id */ balance: 500, lastDaily: Date.now() }  // _id auto-assigned
```

---

## 3. Inserting & Updating — `upsert`

```typescript
const id = await collection.upsert(doc);
```

`upsert` is the single write primitive. It **inserts** the document if `_id` is new, or **fully replaces** the existing document if `_id` already exists. There is no partial patch — send the full document every time.

**Returns:** the `_id` string (useful when you let NovaDB generate it).

```typescript
// Insert a new user (auto ID)
const id = await users.upsert({
    username: 'cooldev',
    xp: 0,
    joinedAt: Date.now()
});
// id === 'a3f7b2c1...' (UUID without hyphens)

// Insert with explicit ID
await users.upsert({
    _id: `user_${interaction.user.id}`,
    username: interaction.user.username,
    xp: 0,
    joinedAt: Date.now()
});

// Update — fetch first, merge, write back
const existing = await users.get(`user_${interaction.user.id}`);
await users.upsert({
    ...existing,
    xp: (existing?.xp ?? 0) + 50
});
```

**Write path:** the document is serialized to MessagePack, appended to the WAL, written into the in-memory memtable, and the call returns. A background timer flushes the WAL buffer to disk every `groupCommitIntervalMs` (default 50 ms). When the memtable exceeds `memtableLimitBytes` (default 4 MB) it's flushed to an SSTable file asynchronously.

---

## 4. Reading — `get`

```typescript
const doc = await collection.get(id);
const doc = await collection.get(id, snapshot);
```

Returns the document or `null` if it doesn't exist (or was deleted).

The optional `snapshot` parameter is a `bigint` transaction ID returned by `openSnapshot()` — see [Snapshots](#8-snapshots--point-in-time-reads).

```typescript
const user = await users.get(`user_${interaction.user.id}`);

if (!user) {
    await interaction.reply('You are not registered.');
    return;
}

await interaction.reply(`Your XP: ${user.xp}`);
```

**Read path (in order):**
1. Active memtable (in-memory, fastest)
2. Immutable memtables queued for flush (in-memory)
3. SSTables on disk — bloom filter checked first to skip files that can't contain the key, then sparse index used to jump to the right block

A cache miss on disk checks the block cache before doing a real `fd.read`.

---

## 5. Deleting — `delete`

```typescript
const deleted = await collection.delete(id);
// returns true always (tombstone written regardless)
```

Writes a tombstone document `{ _id: id, __deleted__: true }` into the WAL and memtable. The document disappears from all reads immediately. The tombstone is physically removed during compaction when it reaches the bottommost SSTable level.

```typescript
await warnings.delete(`warn_${guildId}_${userId}_${timestamp}`);
```

There is no "soft delete" concept you need to manage — calling `get` or `scan` after `delete` will return `null` / skip the document automatically.

---

## 6. Scanning — `scan`

```typescript
for await (const doc of collection.scan(fromId, toId)) { ... }
for await (const doc of collection.scan(fromId, toId, snapshot)) { ... }
```

Streams all documents whose `_id` falls in the range `[fromId, toId]` (inclusive on both ends), in ascending `_id` order. Deleted documents are automatically excluded.

To scan **everything**: pass `''` as `fromId` and `'\uffff'` as `toId`.

```typescript
// All documents
for await (const doc of users.scan('', '\uffff')) {
    console.log(doc._id, doc.username);
}

// All warnings for a specific guild (prefix scan)
const prefix = `warn_${guildId}_`;
for await (const doc of warnings.scan(prefix, prefix + '\uffff')) {
    console.log(doc.reason);
}

// Paginate — IDs starting after a cursor
for await (const doc of economy.scan(lastSeenId + '\x00', '\uffff')) {
    // process up to page size then break
}
```

**Key design tip:** embed meaningful sortable prefixes into `_id` values so range scans are cheap:

```
warn_{guildId}_{userId}_{timestamp}   →  scan all warnings for a guild
msg_{channelId}_{timestamp}_{msgId}   →  scan messages chronologically
```

`scan` opens a merge iterator across the memtable, all immutable memtables, and all SSTables simultaneously and does a heap-merge — you never load the whole dataset into memory.

---

## 7. Transactions

Transactions let you write multiple documents atomically. Either all writes land, or none do. They also get a single `txnId` so MVCC snapshot reads see them as one consistent unit.

```typescript
const txn = collection.beginTransaction();

// Stage writes (no I/O yet)
collection.stageWrite(txn, { _id: 'doc_a', value: 1 });
collection.stageWrite(txn, { _id: 'doc_b', value: 2 });

// Stage a delete inside the same transaction
collection.stageDelete(txn, 'doc_old');

// Commit — flushes WAL, ships to replicas, applies to memtable
await collection.commit(txn);

// Or roll back — discards all staged writes, no I/O
collection.rollback(txn);
```

**API:**

| Method | Description |
|---|---|
| `beginTransaction()` | Creates a new transaction object. Lightweight, no I/O. |
| `stageWrite(txn, doc)` | Queues an upsert. Returns the `_id`. |
| `stageDelete(txn, id)` | Queues a tombstone for `id`. |
| `commit(txn)` | Writes all staged ops to WAL atomically and applies to memtable. Throws if already committed. |
| `rollback(txn)` | Discards all staged writes. Marks transaction as done. |

```typescript
// Real example: transfer XP between two users atomically
async function transferXP(from: string, to: string, amount: number) {
    const col = await this.heart.db.nova.get('main').collection('economy');

    const sender   = await col.get(from);
    const receiver = await col.get(to);

    if (!sender || (sender.balance as number) < amount) throw new Error('Insufficient balance');

    const txn = col.beginTransaction();
    col.stageWrite(txn, { ...sender,   balance: (sender.balance   as number) - amount });
    col.stageWrite(txn, { ...receiver, balance: (receiver.balance as number) + amount });
    await col.commit(txn);
}
```

A committed transaction cannot be reused — call `beginTransaction()` again for a new one.

---

## 8. Snapshots — Point-in-time Reads

A snapshot captures the database state at a specific committed transaction ID. Any reads performed against that snapshot see data exactly as it was when the snapshot was opened — concurrent writes don't bleed through.

```typescript
const snap = collection.openSnapshot();
try {
    const doc = await collection.get(someId, snap);
    for await (const d of collection.scan('', '\uffff', snap)) {
        // consistent view
    }
} finally {
    collection.closeSnapshot(snap); // always release — holds back MVCC GC
}
```

**Always close snapshots.** Open snapshots prevent old versions from being garbage-collected during memtable flushes and compaction, which will grow disk usage unboundedly if forgotten.

```typescript
// Pattern: consistent multi-collection read
const snapA = collA.openSnapshot();
const snapB = collB.openSnapshot();
try {
    const a = await collA.get('key', snapA);
    const b = await collB.get('key', snapB);
    // a and b are from the same logical moment
} finally {
    collA.closeSnapshot(snapA);
    collB.closeSnapshot(snapB);
}
```

---

## 9. Secondary Indexes — `findBy`

NovaDB supports field-level secondary indexes for equality lookups without scanning the full collection.

```typescript
// Create the index once (at boot, or lazily on first use)
await collection.createIndex('fieldName');

// Query
const results = await collection.findBy('fieldName', value);
const results = await collection.findBy('fieldName', value, snapshot);
```

`createIndex` builds the index by scanning the entire collection at creation time, then keeps it updated automatically on every future `upsert`, `delete`, and `commit`.

**Returns:** `NovaDocument[]` — all documents where `doc[fieldName] === value` (string-coerced comparison).

```typescript
// One-time setup (e.g. in your plugin's onLoad)
const members = await this.heart.db.nova.get('main').collection('members');
await members.createIndex('guildId');
await members.createIndex('role');

// Fast lookup — no full scan
const allInGuild = await members.findBy('guildId', interaction.guildId);
const admins     = await members.findBy('role', 'admin');
```

**Implementation detail:** each index is itself a NovaDB collection stored under `.data/database/main/members/_idx/`. The index collection stores `{ _id: fieldValue, ids: string[] }` — a list of document IDs per field value. This means index lookups are two-hop: first look up the IDs list, then `get` each doc. For large result sets, the loop is sequential — use `scan` with a good ID prefix scheme if you need bulk performance.

---

## 10. Replication

NovaDB has a built-in WAL shipping replication system. There are two transports: in-process (for testing / same-process replicas) and TCP (for separate processes or machines).

### In-Process Replication

```typescript
import { InProcessTransport } from '#database/nova.js';

const primary = await novaDB.get('main').collection('events');
const replica = await novaDB.get('replica').collection('events');

const transport = new InProcessTransport();
await replica.openAsReplica(transport);
await primary.addReplica(transport);

// All writes to primary now flow to replica
await primary.upsert({ _id: 'evt_1', type: 'join' });
const doc = await replica.get('evt_1'); // available on replica
```

### TCP Replication

**Primary side (server):**
```typescript
import { TCPReplicaServer } from '#database/nova.js';

const server = new TCPReplicaServer(9000);
await server.listen();
await primaryCollection.addReplica(server);
```

**Replica side (client):**
```typescript
import { TCPReplicaClient } from '#database/nova.js';

const client = new TCPReplicaClient('primary-host', 9000);
await client.connect();
await replicaCollection.openAsReplica(client);
```

### Replication Lag

```typescript
const lagLsn = primaryCollection.replicationLag();
// lagLsn is a bigint — number of WAL entries the slowest replica is behind
```

**Replica collections are read-only** — calling `upsert`, `delete`, or `commit` on a replica throws. Snapshot reads and `scan` work normally.

`addReplica` performs an initial full snapshot sync before handing off live WAL shipping — the replica starts consistent from the moment it connects.

---

## 11. Lifecycle — `close`

```typescript
await this.heart.db.nova.get('main').close();
// or shut everything down via DatabaseManager:
await DatabaseManager.closeAll();
```

`close()` on a `NovaDB` instance:
1. Cancels the group-commit WAL flush timer.
2. Flushes any remaining WAL buffer to disk.
3. Closes the WAL file handle.
4. Closes all open SSTable file descriptors (table cache).
5. Closes all secondary index collections recursively.
6. Closes all replication transports.

In Zene plugins you generally don't call this manually — `DatabaseManager.closeAll()` is called during bot shutdown and handles every registered instance.

---

## 12. Full Plugin Example

A complete self-contained XP plugin demonstrating all features:

```typescript
import type { IHeart } from '#core/heart/index.js';
import type { NovaCollection } from '#database/nova.js';

interface UserDoc {
    _id: string;
    userId: string;
    guildId: string;
    xp: number;
    level: number;
    lastMessage: number;
}

export default class XPPlugin {
    private users!: NovaCollection;

    async onLoad(heart: IHeart) {
        // 1. Get (or create) the collection
        this.users = await heart.db.nova.get('main').collection('xp_users');

        // 2. Create secondary indexes for fast lookups
        await this.users.createIndex('guildId');
        await this.users.createIndex('userId');
    }

    // Called on every message
    async onMessage(heart: IHeart, userId: string, guildId: string) {
        const id  = `${guildId}_${userId}`;
        const now = Date.now();

        // 3. Read the existing document
        const existing = (await this.users.get(id)) as UserDoc | null;

        // Cooldown check
        if (existing && now - existing.lastMessage < 60_000) return;

        const current = existing ?? { _id: id, userId, guildId, xp: 0, level: 0, lastMessage: 0 };
        const newXp   = current.xp + 15;
        const newLvl  = Math.floor(Math.sqrt(newXp / 100));

        // 4. Upsert the updated document
        await this.users.upsert({
            ...current,
            xp:          newXp,
            level:       newLvl,
            lastMessage: now,
        });

        if (newLvl > current.level) {
            heart.log.info(`${userId} leveled up to ${newLvl} in ${guildId}!`);
        }
    }

    // Leaderboard — top users in a guild
    async getLeaderboard(heart: IHeart, guildId: string): Promise<UserDoc[]> {
        // 5. findBy secondary index
        const docs = await this.users.findBy('guildId', guildId) as UserDoc[];
        return docs.sort((a, b) => b.xp - a.xp).slice(0, 10);
    }

    // Export a consistent snapshot of all guild XP
    async exportGuildSnapshot(guildId: string): Promise<UserDoc[]> {
        // 6. Snapshot + scan
        const snap = this.users.openSnapshot();
        const results: UserDoc[] = [];
        try {
            const prefix = `${guildId}_`;
            for await (const doc of this.users.scan(prefix, prefix + '\uffff', snap)) {
                results.push(doc as UserDoc);
            }
        } finally {
            this.users.closeSnapshot(snap);
        }
        return results;
    }

    // Reset multiple users atomically
    async resetUsers(userIds: string[], guildId: string) {
        // 7. Transaction
        const txn = this.users.beginTransaction();
        for (const userId of userIds) {
            this.users.stageDelete(txn, `${guildId}_${userId}`);
        }
        await this.users.commit(txn);
    }
}
```

---

## 13. Internals Cheat Sheet

| Concept | What it means for you |
|---|---|
| **WAL (Write-Ahead Log)** | Every write is appended here first. Survives crashes. Replayed on boot. |
| **Memtable** | In-memory sorted buffer. Reads hit this first — fastest path. |
| **Immutable Memtable** | Memtable being flushed. Still readable. Queued in order. |
| **SSTable** | Immutable on-disk sorted file. Bloom filter + sparse index on each one. |
| **Block Cache** | LRU cache of raw SSTable blocks. Size = `blockCacheCapacity` entries. |
| **Table Cache** | LRU cache of open file descriptors. Size = `tableCacheCapacity` entries. |
| **Compaction** | Background merge of SSTables into larger sorted files. Removes tombstones. |
| **MVCC** | Each write gets a `txnId`. Reads use a snapshot `txnId` to see consistent data. |
| **Bloom Filter** | Probabilistic skip: if a key definitely isn't in an SSTable, no disk read. |
| **Sparse Index** | Jump table pointing into SSTable blocks — avoids full file scans. |
| **Group Commit** | WAL writes are batched every `groupCommitIntervalMs` ms for throughput. |

**ID design matters.** Because `scan` is range-based on string `_id`, embedding your natural partition key (guildId, channelId, userId) as a prefix lets you do fast prefix scans instead of filtering in memory:

```
✅  warn_{guildId}_{userId}_{timestamp}   → scan one user's warnings in one guild
✅  msg_{channelId}_{isoDate}_{snowflake} → chronological channel scan
❌  {uuid}                                → random scatter, prefix scan useless
```

---

*NovaDB is embedded — there is no network hop, no authentication, and no connection pool to manage. It's just files on disk, plus this API.*
