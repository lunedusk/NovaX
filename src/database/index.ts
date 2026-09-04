import { promises as fs, createWriteStream } from 'fs';
import * as path from 'path';
import * as net from 'net';
import { deflateRawSync, inflateRawSync } from 'zlib';
import { Packr } from 'msgpackr';
import murmur from 'murmurhash3js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('NovaDB');

export interface NovaDocument {
    _id?: string;
    __deleted__?: boolean;
    __txnId__?: bigint;
    __lsn__?: string;
    [key: string]: unknown;
}

function readField(doc: NovaDocument, field: string): unknown {
    return doc[field];
}

function readStringIds(entry: NovaDocument | null | undefined): string[] {
    if (!entry) return [];
    const raw = entry['ids'];
    return Array.isArray(raw) ? raw.map(String) : [];
}

function isEnoent(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: unknown }).code === 'ENOENT'
    );
}

function asBigInt(value: unknown): bigint {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' || typeof value === 'string') return BigInt(value);
    return BigInt(String(value));
}

export interface NovaConfig {
    dbDir: string;
    memtableLimitBytes: number;
    blockSize: number;
    l0CompactionThreshold: number;
    groupCommitIntervalMs: number;
    maxWalBufferBytes: number;
    blockCacheCapacity: number;
    tableCacheCapacity: number;
    maxImmutableMemtables: number;
    compactionRateLimitBytesPerSec: number;
    blockCompression: boolean;
    numLevels: number;
    levelSizeMultiplier: number;
    l1MaxBytes: number;
    targetFileSizeBytes: number;
}

type SparseIndex = Array<[string, number]>;

interface SSTableMetadata {
    id: number;
    level: number;
    index: SparseIndex;
    bloom: BloomFilter;
    filePath: string;
    minKey: string;
    maxKey: string;
    keyCount: number;
    sizeBytes: number;
}

const FOOTER_SIZE    = 32;
const FOOTER_MAGIC   = 0xdb42;
const FOOTER_VERSION = 6;

const RECORD_HEADER_SIZE = 11;
const WAL_HEADER_SIZE = 18;

const MANIFEST_FLUSH   = 'FLUSH'   as const;
const MANIFEST_COMPACT = 'COMPACT' as const;

const CRC32C_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0x82F63B78 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c;
    }
    return t;
})();

function crc32c(buf: Buffer, initial = 0xFFFFFFFF): number {
    let c = initial;
    for (let i = 0; i < buf.length; i++) c = CRC32C_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

class BloomFilter {
    public bitArray: Buffer;
    public readonly size: number;
    public readonly hashCount: number;

    constructor(opts: { expectedItems: number; falsePositiveRate?: number } | { size: number; hashCount: number; rawBytes: Buffer }) {
        if ('rawBytes' in opts) {
            this.size      = opts.size;
            this.hashCount = opts.hashCount;
            this.bitArray  = opts.rawBytes;
        } else {
            const fpr      = opts.falsePositiveRate ?? 0.01;
            const n        = Math.max(opts.expectedItems, 1);
            this.size      = Math.ceil(-(n * Math.log(fpr)) / (Math.LN2 * Math.LN2));
            this.hashCount = Math.max(1, Math.ceil((this.size / n) * Math.LN2));
            this.bitArray  = Buffer.alloc(Math.ceil(this.size / 8));
        }
    }

    private probe(item: string): number[] {
        const h1 = murmur.x86.hash32(item, 0) >>> 0;
        const h2 = murmur.x86.hash32(item, 0xdeadbeef) >>> 0;
        const out: number[] = [];
        for (let i = 0; i < this.hashCount; i++)
            out.push(((h1 + Math.imul(i, h2)) >>> 0) % this.size);
        return out;
    }

    add(item: string) {
        for (const b of this.probe(item)) this.bitArray[b >>> 3] |= 1 << (b & 7);
    }

    check(item: string): boolean {
        for (const b of this.probe(item))
            if ((this.bitArray[b >>> 3] & (1 << (b & 7))) === 0) return false;
        return true;
    }
}

interface CacheEntry { data: Buffer; prev: string | null; next: string | null; }

class LRUBlockCache {
    private cache = new Map<string, CacheEntry>();
    private head: string | null = null;
    private tail: string | null = null;
    private readonly capacity: number;

    constructor(capacity: number) { this.capacity = capacity; }

    get(key: string): Buffer | undefined {
        const e = this.cache.get(key);
        if (!e) return undefined;
        this.moveToHead(key, e);
        return e.data;
    }

    set(key: string, data: Buffer) {
        if (this.cache.has(key)) {
            const e = this.cache.get(key)!;
            e.data = data;
            this.moveToHead(key, e);
            return;
        }
        const e: CacheEntry = { data, prev: null, next: this.head };
        if (this.head) this.cache.get(this.head)!.prev = key;
        this.head = key;
        if (!this.tail) this.tail = key;
        this.cache.set(key, e);
        if (this.cache.size > this.capacity) this.evictTail();
    }

    invalidate(prefix: string) {
        for (const key of [...this.cache.keys()]) {
            if (!key.startsWith(prefix)) continue;
            this.unlinkNode(key);
            this.cache.delete(key);
        }
    }

    private unlinkNode(key: string) {
        const e = this.cache.get(key);
        if (!e) return;
        if (e.prev) this.cache.get(e.prev)!.next = e.next; else this.head = e.next;
        if (e.next) this.cache.get(e.next)!.prev = e.prev; else this.tail = e.prev;
        e.prev = null; e.next = null;
    }

    private evictTail() {
        if (!this.tail) return;
        const evict = this.tail;
        this.unlinkNode(evict);
        this.cache.delete(evict);
    }

    private moveToHead(key: string, e: CacheEntry) {
        if (this.head === key) return;
        this.unlinkNode(key);
        e.prev = null; e.next = this.head;
        if (this.head) this.cache.get(this.head)!.prev = key;
        this.head = key;
        if (!this.tail) this.tail = key;
    }
}

class TableCache {
    private cache  = new Map<string, fs.FileHandle>();
    private order: string[] = [];
    private readonly capacity: number;

    constructor(capacity: number) { this.capacity = capacity; }

    async get(filePath: string): Promise<fs.FileHandle> {
        if (this.cache.has(filePath)) return this.cache.get(filePath)!;
        const fd = await fs.open(filePath, 'r');
        this.cache.set(filePath, fd);
        this.order.push(filePath);
        if (this.cache.size > this.capacity) {
            const evict = this.order.shift()!;
            const evFd  = this.cache.get(evict);
            this.cache.delete(evict);
            await evFd?.close().catch(() => {});
        }
        return fd;
    }

    async evict(filePath: string) {
        const fd = this.cache.get(filePath);
        if (!fd) return;
        this.cache.delete(filePath);
        this.order = this.order.filter(p => p !== filePath);
        await fd.close().catch(() => {});
    }

    async closeAll() {
        for (const fd of this.cache.values()) await fd.close().catch(() => {});
        this.cache.clear(); this.order = [];
    }
}

class RateLimiter {
    private bytesThisPeriod = 0;
    private periodStart = Date.now();

    constructor(private readonly bytesPerSec: number) {}

    async consume(bytes: number) {
        if (this.bytesPerSec <= 0) return;
        this.bytesThisPeriod += bytes;
        const elapsed = Date.now() - this.periodStart;
        const allowed = (elapsed / 1000) * this.bytesPerSec;
        if (this.bytesThisPeriod > allowed) {
            const waitMs = ((this.bytesThisPeriod - allowed) / this.bytesPerSec) * 1000;
            await new Promise(r => setTimeout(r, waitMs));
            this.periodStart = Date.now();
            this.bytesThisPeriod = 0;
        }
    }
}

function sparseIndexLookup(index: SparseIndex, targetId: string): number {
    let lo = 0, hi = index.length - 1, best = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (index[mid][0] <= targetId) { best = index[mid][1]; lo = mid + 1; }
        else hi = mid - 1;
    }
    return best;
}

class SnapshotRegistry {
    private snapshots = new Set<bigint>();
    open(txnId: bigint): bigint { this.snapshots.add(txnId); return txnId; }
    close(txnId: bigint)        { this.snapshots.delete(txnId); }
    oldest(): bigint {
        let min = BigInt('0xffffffffffffffff');
        for (const s of this.snapshots) if (s < min) min = s;
        return min;
    }
    hasAny(): boolean { return this.snapshots.size > 0; }
}

interface VersionedEntry {
    versions: Array<[bigint, Buffer]>; 
    totalBytes: number;
}

class SortedMemtable {
    private entries: Array<[string, VersionedEntry]> = [];
    public byteSize = 0;

    private bisect(key: string): { found: boolean; index: number } {
        let lo = 0, hi = this.entries.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const cmp = this.entries[mid][0] < key ? -1 : this.entries[mid][0] > key ? 1 : 0;
            if (cmp === 0) return { found: true, index: mid };
            if (cmp < 0) lo = mid + 1; else hi = mid - 1;
        }
        return { found: false, index: lo };
    }

    set(key: string, txnId: bigint, value: Buffer, oldestSnapshot: bigint) {
        const { found, index } = this.bisect(key);
        if (found) {
            const ve = this.entries[index][1];
            const oldTotal = ve.totalBytes;
            ve.versions.unshift([txnId, value]);
            ve.totalBytes += value.length;
            this.trimVersions(ve, oldestSnapshot);
            this.byteSize += ve.totalBytes - oldTotal;
        } else {
            const ve: VersionedEntry = { versions: [[txnId, value]], totalBytes: value.length };
            this.entries.splice(index, 0, [key, ve]);
            this.byteSize += key.length + value.length;
        }
    }

    private trimVersions(ve: VersionedEntry, oldestSnapshot: bigint) {
        if (ve.versions.length <= 1) return;
        let cutIdx = -1;
        for (let i = 0; i < ve.versions.length; i++) {
            if (ve.versions[i][0] <= oldestSnapshot) { cutIdx = i; break; }
        }
        if (cutIdx >= 0 && cutIdx < ve.versions.length - 1) {
            const dropped = ve.versions.splice(cutIdx + 1);
            for (const [, buf] of dropped) {
                ve.totalBytes -= buf.length;
                this.byteSize -= buf.length;
            }
        }
    }

    get(key: string, snapshot: bigint): Buffer | undefined {
        const { found, index } = this.bisect(key);
        if (!found) return undefined;
        for (const [vid, buf] of this.entries[index][1].versions)
            if (vid <= snapshot) return buf;
        return undefined;
    }

    has(key: string): boolean { return this.bisect(key).found; }

    *[Symbol.iterator](): Iterator<[string, Buffer]> {
        for (const [key, ve] of this.entries)
            yield [key, ve.versions[0][1]];
    }

    *iterSnapshot(snapshot: bigint, fromKey?: string, toKey?: string): Iterator<[string, Buffer]> {
        for (const [key, ve] of this.entries) {
            if (fromKey !== undefined && key < fromKey) continue;
            if (toKey   !== undefined && key > toKey)   break;
            for (const [vid, buf] of ve.versions)
                if (vid <= snapshot) { yield [key, buf]; break; }
        }
    }

    get size(): number { return this.entries.length; }

    toFlushEntries(oldestSnapshot: bigint, hasOpenSnapshots: boolean): Array<[string, Buffer]> {
        if (!hasOpenSnapshots) {
            const out: Array<[string, Buffer]> = [];
            for (const [key, ve] of this.entries) out.push([key, ve.versions[0][1]]);
            return out;
        }

        const out: Array<[string, Buffer]> = [];
        for (const [key, ve] of this.entries) {
            for (const [txnId, buf] of ve.versions) {
                if (txnId >= oldestSnapshot) {
                    out.push([encodeVersionedKey(key, txnId), buf]);
                }
            }
            out.push([key, ve.versions[0][1]]);
        }
        out.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
        
        const seen = new Set<string>();
        return out.filter(([k]) => { if (seen.has(k)) return false; seen.add(k); return true; });
    }

    toMap(): Map<string, Buffer> {
        const m = new Map<string, Buffer>();
        for (const [key, buf] of this) m.set(key, buf);
        return m;
    }
}

const VERSION_PREFIX = '\x00V';

function encodeVersionedKey(id: string, txnId: bigint): string {
    return VERSION_PREFIX + txnId.toString(16).padStart(16, '0') + '\x00' + id;
}

function isVersionedKey(key: string): boolean {
    return key.startsWith(VERSION_PREFIX);
}

function decodeVersionedKey(key: string): { id: string; txnId: bigint } {
    const txnHex = key.slice(2, 18);
    const id     = key.slice(19);
    return { id, txnId: BigInt('0x' + txnHex) };
}

interface KVIterator {
    key:      string | null;
    value:    Buffer | null;
    readonly priority: number;
    advance(): Promise<void>;
    close?():  Promise<void>;
}

class MemtableIterator implements KVIterator {
    private iter: Iterator<[string, Buffer]>;
    key:   string | null = null;
    value: Buffer | null = null;
    readonly priority: number;

    constructor(mem: SortedMemtable, priority: number, snapshot: bigint, fromKey?: string, toKey?: string) {
        this.priority = priority;
        this.iter     = mem.iterSnapshot(snapshot, fromKey, toKey);
    }

    async advance() {
        const { value, done } = this.iter.next();
        if (done) { this.key = null; this.value = null; }
        else       { [this.key, this.value] = value; }
    }
}

class SSTableIterator implements KVIterator {
    key:   string | null = null;
    value: Buffer | null = null;
    readonly priority: number;

    private fd!: fs.FileHandle;
    private position    = 0;
    private indexOffset = 0;
    private closed      = false;

    constructor(
        private readonly filePath: string,
        private readonly config:  NovaConfig,
        priority: number,
        private readonly fromKey?: string,
        private readonly toKey?:  string,
        private readonly meta?:   SSTableMetadata,
    ) { this.priority = priority; }

    async open() {
        this.fd = await fs.open(this.filePath, 'r');
        const stat      = await this.fd.stat();
        const footerBuf = Buffer.alloc(FOOTER_SIZE);
        await this.fd.read(footerBuf, 0, FOOTER_SIZE, stat.size - FOOTER_SIZE);
        this.indexOffset = Number(footerBuf.readBigUInt64BE(0));

        if (this.fromKey && this.meta && this.meta.index.length > 0)
            this.position = sparseIndexLookup(this.meta.index, this.fromKey);
    }

    async advance() {
        if (this.closed) { this.key = null; this.value = null; return; }
        while (this.position < this.indexOffset) {
            if (this.position + RECORD_HEADER_SIZE > this.indexOffset) break;

            const hdr = Buffer.alloc(RECORD_HEADER_SIZE);
            const { bytesRead: hr } = await this.fd.read(hdr, 0, RECORD_HEADER_SIZE, this.position);
            if (hr < RECORD_HEADER_SIZE) break;

            const keyLen    = hdr.readUInt16BE(0);
            const docLen    = hdr.readUInt32BE(2);
            const storedCrc = hdr.readUInt32BE(6);
            const flags     = hdr.readUInt8(10);
            this.position  += RECORD_HEADER_SIZE;

            const keyBuf = Buffer.alloc(keyLen);
            await this.fd.read(keyBuf, 0, keyLen, this.position);
            this.position += keyLen;

            const docBuf = Buffer.alloc(docLen);
            await this.fd.read(docBuf, 0, docLen, this.position);
            this.position += docLen;

            const decompDoc = (flags & 0x01) ? inflateRawSync(docBuf) : docBuf;
            const actualCrc = crc32c(Buffer.concat([keyBuf, decompDoc]));
            if (actualCrc !== storedCrc) {
                log.error(`Block CRC mismatch during scan at offset ${this.position}; stopping.`);
                break;
            }

            const key = keyBuf.toString('utf-8');
            if (this.toKey   !== undefined && key > this.toKey)   break;
            if (this.fromKey !== undefined && key < this.fromKey) continue;

            this.key   = key;
            this.value = decompDoc;
            return;
        }
        this.key = null; this.value = null;
        await this.close();
    }

    async close() {
        if (!this.closed) { this.closed = true; await this.fd?.close().catch(() => {}); }
    }
}

class MergeHeap {
    private heap: KVIterator[] = [];

    push(iter: KVIterator) { this.heap.push(iter); this.siftUp(this.heap.length - 1); }

    pop(): KVIterator | undefined {
        if (this.heap.length === 0) return undefined;
        this.swap(0, this.heap.length - 1);
        const top = this.heap.pop();
        if (this.heap.length > 0) this.siftDown(0);
        return top;
    }

    get size() { return this.heap.length; }

    private siftUp(i: number) {
        while (i > 0) {
            const p = (i - 1) >>> 1;
            if (this.less(i, p)) { this.swap(i, p); i = p; } else break;
        }
    }

    private siftDown(i: number) {
        const n = this.heap.length;
        while (true) {
            let min = i;
            const l = 2 * i + 1, r = 2 * i + 2;
            if (l < n && this.less(l, min)) min = l;
            if (r < n && this.less(r, min)) min = r;
            if (min === i) break;
            this.swap(i, min); i = min;
        }
    }

    private less(a: number, b: number): boolean {
        const ka = this.heap[a].key!, kb = this.heap[b].key!;
        if (ka !== kb) return ka < kb;
        return this.heap[a].priority < this.heap[b].priority;
    }

    private swap(a: number, b: number) {
        [this.heap[a], this.heap[b]] = [this.heap[b], this.heap[a]];
    }
}

interface ManifestFlushEntry { type: typeof MANIFEST_FLUSH; lsn: string; sstableId: number; level: number; timestamp: number; }
interface ManifestCompactEntry { type: typeof MANIFEST_COMPACT; removedIds: number[]; addedIds: number[]; addedLevel: number; timestamp: number; }
interface ManifestCheckpointEntry { type: 'CHECKPOINT'; lsn: string; sstables: Array<{ id: number; level: number }>; timestamp: number; }
type ManifestEntry = ManifestFlushEntry | ManifestCompactEntry | ManifestCheckpointEntry;

interface Transaction {
    txnId?: bigint;
    writes: Map<string, NovaDocument>;
    committed: boolean;
}

interface IndexDescriptor {
    name: string;
    field: string;
    collection: NovaCollection;
}

export interface WalRecord {
    lsn:    bigint;
    keyBuf: Buffer;
    docBuf: Buffer;
    txnId?: bigint;
    batchSize?: number;
    batchIndex?: number;
}

export interface ReplicaTransport {
    ship(record: WalRecord): Promise<void>;
    onRecord?(handler: (record: WalRecord) => Promise<void>): void;
    ackedLsn(): bigint;
    close(): Promise<void>;
}

class SerialQueue {
    private tail: Promise<void> = Promise.resolve();
    enqueue(fn: () => Promise<void>): void {
        this.tail = this.tail.then(fn).catch(err => {
            const error = err instanceof Error ? err : new Error(String(err));
            log.error(`SerialQueue error: ${error.message}`, {
                stack: error.stack,
            });
        });
    }
    drain(): Promise<void> { return this.tail; }
}

export class InProcessTransport implements ReplicaTransport {
    private handler?:    (record: WalRecord) => Promise<void>;
    private _ackedLsn:  bigint = -1n;
    private readonly q = new SerialQueue();

    async ship(record: WalRecord): Promise<void> {
        if (!this.handler) return;
        const h = this.handler;
        this.q.enqueue(async () => {
            await h(record);
            this._ackedLsn = record.lsn;
        });
        await this.q.drain();
    }
    onRecord(handler: (record: WalRecord) => Promise<void>) { this.handler = handler; }
    ackedLsn(): bigint { return this._ackedLsn; }
    async close(): Promise<void> {}
}

const TCP_FRAME_FIXED = 34;

export class TCPReplicaServer implements ReplicaTransport {
    private server:  net.Server;
    private clients: net.Socket[] = [];
    private _ackedLsn: bigint = -1n;

    constructor(private readonly port: number) {
        this.server = net.createServer(socket => {
            this.clients.push(socket);
            socket.on('close', () => { this.clients = this.clients.filter(c => c !== socket); });
            socket.on('error', () => { this.clients = this.clients.filter(c => c !== socket); });
        });
    }

    async listen(): Promise<void> {
        return new Promise((res, rej) => {
            this.server.listen(this.port, () => res());
            this.server.on('error', rej);
        });
    }

    async ship(record: WalRecord): Promise<void> {
        const frame = this.encodeFrame(record);
        for (const sock of [...this.clients]) {
            if (!sock.writable) continue;
            await new Promise<void>((res, rej) => sock.write(frame, err => err ? rej(err) : res())).catch(() => {});
        }
    }

    encodeFrame(r: WalRecord): Buffer {
        const bodyLen = r.keyBuf.length + r.docBuf.length;
        const frame   = Buffer.alloc(4 + TCP_FRAME_FIXED + bodyLen);
        let off = 0;
        frame.writeUInt32BE(TCP_FRAME_FIXED + bodyLen, off); off += 4;
        frame.writeBigUInt64BE(r.lsn,              off); off += 8;
        frame.writeBigUInt64BE(r.txnId ?? r.lsn,   off); off += 8;
        frame.writeUInt32BE(r.batchSize  ?? 1,     off); off += 4;
        frame.writeUInt32BE(r.batchIndex ?? 1,     off); off += 4;
        frame.writeUInt16BE(r.keyBuf.length,       off); off += 2;
        frame.writeUInt32BE(r.docBuf.length,       off); off += 4;
        r.keyBuf.copy(frame, off); off += r.keyBuf.length;
        r.docBuf.copy(frame, off);
        return frame;
    }

    onRecord(_handler: (record: WalRecord) => Promise<void>) {}
    ackedLsn(): bigint { return this._ackedLsn; }
    async close(): Promise<void> {
        for (const s of this.clients) s.destroy();
        await new Promise<void>(res => this.server.close(() => res()));
    }
}

export class TCPReplicaClient implements ReplicaTransport {
    private handler?: (record: WalRecord) => Promise<void>;
    private socket?:  net.Socket;
    private _ackedLsn: bigint = -1n;
    private buf    = Buffer.alloc(0);
    private closed = false;
    private readonly q = new SerialQueue();

    constructor(private readonly host: string, private readonly port: number) {}

    async connect(): Promise<void> {
        return new Promise((res, rej) => {
            this.socket = net.createConnection({ host: this.host, port: this.port }, () => res());
            this.socket.on('error', rej);
            this.socket.on('data', (chunk: Buffer) => {
                this.buf = Buffer.concat([this.buf, chunk]);
                this.drainFrames();
            });
            this.socket.on('close', () => {
                if (!this.closed) setTimeout(() => this.connect().catch(() => {}), 1000);
            });
        });
    }

    private decodeFrame(frame: Buffer): WalRecord {
        let off = 0;
        const lsn       = frame.readBigUInt64BE(off); off += 8;
        const txnId     = frame.readBigUInt64BE(off); off += 8;
        const batchSize = frame.readUInt32BE(off);    off += 4;
        const batchIndex= frame.readUInt32BE(off);    off += 4;
        const keyLen    = frame.readUInt16BE(off);    off += 2;
        const docLen    = frame.readUInt32BE(off);    off += 4;
        const keyBuf    = frame.subarray(off, off + keyLen); off += keyLen;
        const docBuf    = frame.subarray(off, off + docLen);
        return { lsn, txnId, batchSize, batchIndex, keyBuf, docBuf };
    }

    private drainFrames() {
        while (this.buf.length >= 4) {
            const frameLen = this.buf.readUInt32BE(0);
            if (this.buf.length < 4 + frameLen) break;
            const frame = Buffer.from(this.buf.subarray(4, 4 + frameLen)); 
            this.buf = this.buf.subarray(4 + frameLen);

            const record  = this.decodeFrame(frame);
            const handler = this.handler;
            if (handler) {
                this.q.enqueue(async () => {
                    await handler(record);
                    this._ackedLsn = record.lsn;
                });
            }
        }
    }

    async ship(_record: WalRecord): Promise<void> {}
    onRecord(handler: (record: WalRecord) => Promise<void>) { this.handler = handler; }
    ackedLsn(): bigint { return this._ackedLsn; }
    async close(): Promise<void> {
        this.closed = true;
        this.socket?.destroy();
    }
}

export class ReplicationManager {
    private transports: ReplicaTransport[] = [];

    register(t: ReplicaTransport) { this.transports.push(t); }

    replace(oldT: ReplicaTransport, newT: ReplicaTransport) {
        this.transports = this.transports.map(t => t === oldT ? newT : t);
    }

    async shipAll(record: WalRecord): Promise<void> {
        await Promise.allSettled(this.transports.map(t => t.ship(record)));
    }

    maxLagLsn(primaryLsn: bigint): bigint {
        let maxLag = 0n;
        for (const t of this.transports) {
            const lag = primaryLsn - t.ackedLsn();
            if (lag > maxLag) maxLag = lag;
        }
        return maxLag;
    }

    async closeAll(): Promise<void> {
        await Promise.allSettled(this.transports.map(t => t.close()));
    }
}

const packr = new Packr({ useRecords: false });

export class NovaCollection {
    private readonly name:          string;
    private readonly config:        NovaConfig;
    private readonly collectionDir: string;

    private memtable       = new SortedMemtable();
    private immutableQueue: SortedMemtable[] = [];

    private walFd:            fs.FileHandle | null = null;
    private walBuffer:        Buffer[]  = [];
    private walBufferBytes    = 0;
    private walLsn:           bigint    = 0n;
    private groupCommitTimer!: NodeJS.Timeout;
    private walFlushInProgress = false;

    private levels: SSTableMetadata[][] = [];

    private _sstablesCache: SSTableMetadata[] | null = null;
    private get sstables(): SSTableMetadata[] {
        if (this._sstablesCache === null)
            this._sstablesCache = this.levels.flat().sort((a, b) => b.id - a.id);
        return this._sstablesCache;
    }
    private invalidateSstablesCache() { this._sstablesCache = null; }

    private nextSstableId = 0;
    private isCompacting  = false;

    private readonly blockCache: LRUBlockCache;
    private readonly tableCache: TableCache;

    private nextTxnId:       bigint = 1n;
    private committedTxnId:  bigint = 0n;
    private readonly snapshotRegistry = new SnapshotRegistry();

    private readonly replication = new ReplicationManager();
    private isReplica            = false;
    private replicaTxnBuffer = new Map<bigint, WalRecord[]>();
    private replicaSeenLsns  = new Set<bigint>();

    private readonly secondaryIndexes: Map<string, IndexDescriptor> = new Map();

    constructor(name: string, config: NovaConfig) {
        this.name          = name;
        this.config        = config;
        this.collectionDir = path.join(config.dbDir, name);
        this.blockCache    = new LRUBlockCache(config.blockCacheCapacity);
        this.tableCache    = new TableCache(config.tableCacheCapacity);
        const numLevels = config.numLevels ?? 7;
        for (let i = 0; i < numLevels; i++) this.levels.push([]);
    }

    async boot() {
        await fs.mkdir(this.collectionDir, { recursive: true });
        await this.cleanupOrphanedTempFiles();
        await this.loadFromManifest();
        await this.recoverAllFlushingWals();
        await this.recoverFromWAL(path.join(this.collectionDir, 'active.wal'));
        this.walFd = await fs.open(path.join(this.collectionDir, 'active.wal'), 'a');
        this.groupCommitTimer = setInterval(() => this.flushWal(), this.config.groupCommitIntervalMs);
        this.groupCommitTimer.unref();
    }

    async close() {
        clearInterval(this.groupCommitTimer);
        if (this.walFd) {
            await this.flushWal();
            await this.walFd.close();
            this.walFd = null;
        }
        await this.tableCache.closeAll();
        for (const idx of this.secondaryIndexes.values()) await idx.collection.close();
        await this.replication.closeAll();
    }

    async addReplica(transport: ReplicaTransport): Promise<void> {
        let buffering = true;
        const buffer: WalRecord[] = [];

        const proxyTransport: ReplicaTransport = {
            ship: async (record: WalRecord) => {
                if (buffering) buffer.push(record);
                else await transport.ship(record);
            },
            ackedLsn: () => transport.ackedLsn(),
            close: () => transport.close(),
            onRecord: transport.onRecord ? (cb) => transport.onRecord!(cb) : undefined
        };

        this.replication.register(proxyTransport);

        let snapshotLsn = 0n;
        const snap      = this.openSnapshot();
        try {
            for await (const doc of this.scan('', '\uffff', snap)) {
                await transport.ship({
                    lsn:        snapshotLsn++,
                    txnId:      typeof doc.__txnId__ === 'bigint' ? doc.__txnId__ : 0n,
                    batchSize:  1,
                    batchIndex: 1,
                    keyBuf:     Buffer.from(doc._id!),
                    docBuf:     packr.pack(doc),
                });
            }
        } finally {
            this.closeSnapshot(snap);
        }

        for (const rec of buffer) await transport.ship(rec);
        buffering = false;
        this.replication.replace(proxyTransport, transport);
    }

    async openAsReplica(transport: ReplicaTransport) {
        this.isReplica = true;
        transport.onRecord!(async (record) => {
            await this.applyReplicaRecord(record);
        });
    }

    private async applyReplicaRecord(record: WalRecord) {
        if (this.replicaSeenLsns.has(record.lsn)) return;
        this.replicaSeenLsns.add(record.lsn);

        if (this.replicaSeenLsns.size > 10_000) {
            const cutoff = record.lsn - 5000n;
            for (const lsn of this.replicaSeenLsns)
                if (lsn < cutoff) this.replicaSeenLsns.delete(lsn);
        }

        const txnId    = record.txnId    ?? record.lsn;
        const batchSz  = record.batchSize  ?? 1;
        const batchIdx = record.batchIndex ?? 1;

        if (batchSz === 1) {
            await this.applyReplicaWrites([record], txnId);
            return;
        }

        const buf = this.replicaTxnBuffer.get(txnId) ?? [];
        buf.push(record);
        this.replicaTxnBuffer.set(txnId, buf);

        if (batchIdx === batchSz) {
            this.replicaTxnBuffer.delete(txnId);
            await this.applyReplicaWrites(buf, txnId);
        }
    }

    private async applyReplicaWrites(records: WalRecord[], txnId: bigint) {
        const oldest = this.snapshotRegistry.oldest();
        for (const r of records) {
            const id  = r.keyBuf.toString('utf-8');
            this.memtable.set(id, txnId, r.docBuf, oldest);
        }
        if (txnId > this.committedTxnId) this.committedTxnId = txnId;
        if (txnId >= this.nextTxnId)     this.nextTxnId      = txnId + 1n;

        if (this.memtable.byteSize >= this.config.memtableLimitBytes &&
            this.immutableQueue.length < this.config.maxImmutableMemtables) {
            await this.triggerBackgroundFlush();
        }
    }

    replicationLag(): bigint { return this.replication.maxLagLsn(this.walLsn); }

    async createIndex(field: string): Promise<void> {
        if (this.secondaryIndexes.has(field)) return;
        const idxConfig: NovaConfig = { ...this.config, dbDir: path.join(this.collectionDir, '_idx') };
        const idxColl = new NovaCollection(`idx_${field}`, idxConfig);
        await idxColl.boot();
        const descriptor: IndexDescriptor = { name: `idx_${field}`, field, collection: idxColl };
        this.secondaryIndexes.set(field, descriptor);
        
        for await (const doc of this.scan('', '\uffff')) {
            const val = readField(doc, field);
            if (val !== undefined && val !== null)
                await this.updateSecondaryIndex(descriptor, String(val), doc._id!, null);
        }
    }

    private async updateSecondaryIndex(idx: IndexDescriptor, fieldValue: string, docId: string, oldFieldValue: string | null) {
        if (oldFieldValue !== null && oldFieldValue !== fieldValue) {
            const oldEntry = await idx.collection.get(oldFieldValue);
            if (oldEntry) {
                const ids: string[] = readStringIds(oldEntry);
                const newIds = ids.filter(id => id !== docId);
                if (newIds.length === 0) await idx.collection.delete(oldFieldValue);
                else                     await idx.collection.upsert({ _id: oldFieldValue, ids: newIds });
            }
        }
        const existing = await idx.collection.get(fieldValue);
        const ids: string[] = existing ? readStringIds(existing) : [];
        if (!ids.includes(docId)) {
            ids.push(docId);
            await idx.collection.upsert({ _id: fieldValue, ids });
        }
    }

    async findBy(field: string, value: unknown, snapshot?: bigint): Promise<NovaDocument[]> {
        const idx = this.secondaryIndexes.get(field);
        if (!idx) throw new Error(`No index on field "${field}". Call createIndex("${field}") first.`);
        const entry = await idx.collection.get(String(value));
        if (!entry) return [];
        const ids: string[] = readStringIds(entry);
        const docs: NovaDocument[] = [];
        for (const id of ids) {
            const doc = await this.get(id, snapshot);
            if (doc) docs.push(doc);
        }
        return docs;
    }

    beginTransaction(): Transaction {
        return { txnId: undefined, writes: new Map(), committed: false };
    }

    stageWrite(txn: Transaction, doc: NovaDocument): string {
        if (txn.committed) throw new Error('Transaction already committed');
        if (!doc._id) doc._id = crypto.randomUUID().replace(/-/g, '');
        txn.writes.set(doc._id, { ...doc });
        return doc._id;
    }

    stageDelete(txn: Transaction, id: string) {
        this.stageWrite(txn, { _id: id, __deleted__: true });
    }

    async commit(txn: Transaction): Promise<void> {
        if (txn.committed) throw new Error('Transaction already committed');
        if (txn.writes.size === 0) { txn.committed = true; return; }

        const txnId = this.nextTxnId++;
        txn.txnId   = txnId;

        for (const [, doc] of txn.writes) doc.__txnId__ = txnId;

        const batchSize = txn.writes.size;
        let batchIndex  = 1;
        const records: Buffer[] = [];
        const walRecords: WalRecord[] = [];

        for (const [, doc] of txn.writes) {
            const binaryData = packr.pack(doc);
            const idBuffer   = Buffer.from(doc._id!);
            const checksum   = crc32c(Buffer.concat([idBuffer, binaryData]));
            const header     = Buffer.alloc(WAL_HEADER_SIZE);
            const lsn        = this.walLsn++;
            header.writeBigUInt64BE(lsn, 0);
            header.writeUInt16BE(idBuffer.length, 8);
            header.writeUInt32BE(binaryData.length, 10);
            header.writeUInt32BE(checksum, 14);
            records.push(Buffer.concat([header, idBuffer, binaryData]));
            walRecords.push({ lsn, txnId, batchSize, batchIndex: batchIndex++, keyBuf: idBuffer, docBuf: binaryData });
        }

        const batch = Buffer.concat(records);
        this.walBuffer.push(batch);
        this.walBufferBytes += batch.length;
        await this.flushWal();
        this.committedTxnId = txnId > this.committedTxnId ? txnId : this.committedTxnId;

        for (const wr of walRecords) await this.replication.shipAll(wr);

        const oldest = this.snapshotRegistry.oldest();
        for (const [id, doc] of txn.writes) {
            const binaryData = packr.pack(doc);
            const prevBuf    = this.memtable.get(id, this.committedTxnId);
            const prevDoc    = prevBuf ? packr.unpack(prevBuf) as NovaDocument : null;
            this.memtable.set(id, txnId, binaryData, oldest);
            
            for (const idx of this.secondaryIndexes.values()) {
                const newVal = readField(doc, idx.field);
                const oldVal = prevDoc ? readField(prevDoc, idx.field) : null;
                if (newVal !== undefined && newVal !== null)
                    await this.updateSecondaryIndex(idx, String(newVal), id,
                        oldVal !== undefined && oldVal !== null ? String(oldVal) : null);
            }
        }
        txn.committed = true;

        if (this.memtable.byteSize >= this.config.memtableLimitBytes) {
            if (this.immutableQueue.length >= this.config.maxImmutableMemtables)
                await this.waitForImmutableSlot();
            await this.triggerBackgroundFlush();
        }
    }

    rollback(txn: Transaction) {
        txn.writes.clear();
        txn.committed = true;
    }

    openSnapshot(): bigint { return this.snapshotRegistry.open(this.committedTxnId); }
    closeSnapshot(snap: bigint) { this.snapshotRegistry.close(snap); }

    private async flushWal() {
        if (this.walFlushInProgress || this.walBuffer.length === 0 || !this.walFd) return;
        this.walFlushInProgress = true;
        try {
            const data = Buffer.concat(this.walBuffer);
            await this.walFd.appendFile(data);
            await this.walFd.datasync();
            this.walBuffer = [];
            this.walBufferBytes = 0;
        } finally {
            this.walFlushInProgress = false;
        }
    }

    private async writeWalRecord(idBuffer: Buffer, binaryData: Buffer, txnId: bigint): Promise<void> {
        const checksum = crc32c(Buffer.concat([idBuffer, binaryData]));
        const header   = Buffer.alloc(WAL_HEADER_SIZE);
        const lsn      = this.walLsn++;
        header.writeBigUInt64BE(lsn, 0);
        header.writeUInt16BE(idBuffer.length, 8);
        header.writeUInt32BE(binaryData.length, 10);
        header.writeUInt32BE(checksum, 14);
        const record = Buffer.concat([header, idBuffer, binaryData]);
        this.walBuffer.push(record);
        this.walBufferBytes += record.length;
        await this.flushWal();
        await this.replication.shipAll({ lsn, txnId, batchSize: 1, batchIndex: 1, keyBuf: idBuffer, docBuf: binaryData });
    }

    private async recoverAllFlushingWals() {
        const files = await fs.readdir(this.collectionDir);
        const flushingWals = files.filter(f => f.startsWith('flushing_') && f.endsWith('.wal')).sort();
        for (const f of flushingWals) await this.recoverFromWAL(path.join(this.collectionDir, f));
    }

    private async recoverFromWAL(walPath: string) {
        let buffer: Buffer;
        try {
            const stat = await fs.stat(walPath);
            if (stat.size === 0) return;
            buffer = await fs.readFile(walPath);
        } catch (err: unknown) {
            if (isEnoent(err)) return;
            throw err;
        }

        log.info(`[${this.name}] Replaying WAL: ${path.basename(walPath)}`);
        let offset = 0, recovered = 0;

        while (offset + WAL_HEADER_SIZE <= buffer.length) {
            const lsn       = buffer.readBigUInt64BE(offset);
            const keyLen    = buffer.readUInt16BE(offset + 8);
            const docLen    = buffer.readUInt32BE(offset + 10);
            const storedCrc = buffer.readUInt32BE(offset + 14);
            offset += WAL_HEADER_SIZE;

            if (offset + keyLen + docLen > buffer.length) break;

            const keyBuf = buffer.subarray(offset, offset + keyLen);
            offset += keyLen;
            const docBuf = buffer.subarray(offset, offset + docLen);
            offset += docLen;

            const actualCrc = crc32c(Buffer.concat([keyBuf, docBuf]));
            if (actualCrc !== storedCrc) {
                log.warn(`[${this.name}] WAL CRC mismatch at LSN ${lsn}; truncating.`);
                break;
            }

            const id   = keyBuf.toString('utf-8');
            const sstV = await this.probeSStableForTombstone(id);
            if (sstV !== null && sstV >= lsn) {
                if (lsn + 1n > this.walLsn) this.walLsn = lsn + 1n;
                continue;
            }

            const doc   = packr.unpack(docBuf) as NovaDocument;
            const txnId = doc.__txnId__ !== undefined ? asBigInt(doc.__txnId__) : lsn;
            this.memtable.set(id, txnId, docBuf, this.snapshotRegistry.oldest());
            if (lsn + 1n > this.walLsn) this.walLsn = lsn + 1n;
            if (txnId > this.committedTxnId) this.committedTxnId = txnId;
            if (txnId >= this.nextTxnId)     this.nextTxnId      = txnId + 1n;
            recovered++;
        }
        log.info(`[${this.name}] Recovered ${recovered} entries.`);
    }

    private async probeSStableForTombstone(id: string): Promise<bigint | null> {
        for (const sstable of this.sstables) {
            if (!sstable.bloom.check(id)) continue;
            try {
                const doc = await this.readRecordFromDisk(sstable, id);
                if (doc?.__deleted__) return BigInt((doc.__lsn__ as string | number | bigint | undefined) ?? 0);
            } catch (err: unknown) {
                const error = err instanceof Error ? err : new Error(String(err));
                log.error(`Error occurred while probing SSTable: ${error.message}`, {
                    stack: error.stack,
                });
                if (isEnoent(err)) continue;
            }
        }
        return null;
    }

    private async cleanupOrphanedTempFiles() {
        const files = await fs.readdir(this.collectionDir);
        for (const f of files) {
            if (f.endsWith('.tmp')) {
                await fs.unlink(path.join(this.collectionDir, f)).catch(() => {});
                log.info(`[${this.name}] Cleaned orphaned temp: ${f}`);
            }
        }
    }

    private async loadFromManifest() {
        const manifestPath = path.join(this.collectionDir, 'MANIFEST');
        let entries: ManifestEntry[] = [];
        let manifestPresent = false;
        try {
            const raw = await fs.readFile(manifestPath, 'utf-8');
            manifestPresent = true;
            const lines = raw.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                try {
                    entries.push(JSON.parse(line) as ManifestEntry);
                } catch {
                    log.warn(
                        `MANIFEST corrupt/truncated at line ${i + 1} – using ${entries.length} valid entries before corruption`
                    );
                    break;
                }
            }
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                log.warn(`MANIFEST unreadable: ${error.message}`, {
                    stack: error.stack,
                });
            }
        }

        if (entries.length === 0) {
            if (!manifestPresent) await this.loadSSTablesMetadata();
            return;
        }

        const activeFiles = new Map<number, number>();
        let checkpointLsn = 0n;

        for (const e of entries) {
            if (e.type === 'CHECKPOINT') {
                activeFiles.clear();
                for (const { id, level } of e.sstables) activeFiles.set(id, level);
                checkpointLsn = BigInt(e.lsn);
            } else if (e.type === MANIFEST_FLUSH) {
                activeFiles.set(e.sstableId, e.level);
                const lsn = BigInt(e.lsn);
                if (lsn + 1n > this.walLsn) this.walLsn = lsn + 1n;
            } else if (e.type === MANIFEST_COMPACT) {
                for (const id of e.removedIds) activeFiles.delete(id);
                for (const id of e.addedIds) activeFiles.set(id, e.addedLevel);
            }
        }

        for (const [id, level] of activeFiles) {
            const filePath = path.join(this.collectionDir, `sstable_${id.toString().padStart(5, '0')}.dat`);
            try {
                const meta = await this.readSSTableMetadata(filePath, id, level);
                this.levels[level].push(meta);
                this.nextSstableId = Math.max(this.nextSstableId, id + 1);
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                log.error(`Skipping corrupt SSTable ${id}: ${error.message}`, {
                    stack: error.stack,
                });
            }
        }

        try {
            const files = await fs.readdir(this.collectionDir);
            for (const f of files) {
                if (!f.startsWith('sstable_') || !f.endsWith('.dat')) continue;
                const id = parseInt(f.slice('sstable_'.length, f.length - '.dat'.length), 10);
                if (!Number.isFinite(id) || activeFiles.has(id)) continue;
                await fs.unlink(path.join(this.collectionDir, f)).catch(() => {});
                log.info(`[${this.name}] Removed orphan SSTable not in manifest: ${f}`);
            }
        } catch { }

        this.invalidateSstablesCache();
        await this.writeManifestCheckpoint(checkpointLsn);
    }

    private async writeManifestCheckpoint(lsn: bigint) {
        const manifestPath = path.join(this.collectionDir, 'MANIFEST');
        const checkpoint: ManifestCheckpointEntry = {
            type: 'CHECKPOINT', lsn: lsn.toString(),
            sstables:  this.sstables.map(t => ({ id: t.id, level: t.level })),
            timestamp: Date.now(),
        };
        const tmp = manifestPath + '.tmp';
        await fs.writeFile(tmp, JSON.stringify(checkpoint) + '\n');
        await fs.rename(tmp, manifestPath);
    }

    private async appendManifest(entry: ManifestEntry) {
        await fs.appendFile(path.join(this.collectionDir, 'MANIFEST'), JSON.stringify(entry) + '\n');
    }

    private async loadSSTablesMetadata() {
        const files = await fs.readdir(this.collectionDir);
        const datFiles = files.filter(f => f.startsWith('sstable_') && f.endsWith('.dat')).sort();
        for (const file of datFiles) {
            const id = parseInt(file.split('_')[1].split('.')[0], 10);
            this.nextSstableId = Math.max(this.nextSstableId, id + 1);
            const filePath = path.join(this.collectionDir, file);
            try {
                const meta = await this.readSSTableMetadata(filePath, id, 0);
                this.levels[0].push(meta);
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                log.error(`Skipping corrupt SSTable ${file}: ${error.message}`, {
                    stack: error.stack,
                });
            }
        }
        this.invalidateSstablesCache();
    }

    private async readSSTableMetadata(filePath: string, id: number, level: number): Promise<SSTableMetadata> {
        const fd = await fs.open(filePath, 'r');
        try {
            const stat      = await fd.stat();
            const footerBuf = Buffer.alloc(FOOTER_SIZE);
            await fd.read(footerBuf, 0, FOOTER_SIZE, stat.size - FOOTER_SIZE);

            const magic = footerBuf.readUInt16BE(22);
            if (magic !== FOOTER_MAGIC) throw new Error(`Bad magic: 0x${magic.toString(16)}`);

            const indexOffset   = Number(footerBuf.readBigUInt64BE(0));
            const bloomOffset   = Number(footerBuf.readBigUInt64BE(8));
            const bloomSizeBits = footerBuf.readUInt32BE(16);
            const hashCount     = footerBuf.readUInt16BE(20);
            const version       = footerBuf.readUInt32BE(24);
            const keyCount      = version >= 4 ? footerBuf.readUInt32BE(28) : 0;

            const metadataSize = stat.size - FOOTER_SIZE - indexOffset;
            if (metadataSize <= 0) throw new Error('SSTable metadata region is empty');

            const metaBuf = Buffer.alloc(metadataSize);
            await fd.read(metaBuf, 0, metadataSize, indexOffset);

            const sparseIndex: SparseIndex = packr.unpack(metaBuf.subarray(0, bloomOffset - indexOffset));
            const bloomRegion = metaBuf.subarray(bloomOffset - indexOffset);
            const bloom = new BloomFilter({ size: bloomSizeBits, hashCount, rawBytes: bloomRegion });

            const minKey = sparseIndex.length > 0 ? sparseIndex[0][0] : '';
            const maxKey = sparseIndex.length > 0 ? sparseIndex[sparseIndex.length - 1][0] : '';

            return {
                id, level, index: sparseIndex, bloom, filePath,
                minKey, maxKey, keyCount, sizeBytes: stat.size,
            };
        } finally {
            await fd.close();
        }
    }

    async upsert(doc: NovaDocument): Promise<string> {
        if (this.isReplica) throw new Error('Cannot write to a replica collection');
        if (!doc._id) doc._id = crypto.randomUUID().replace(/-/g, '');

        const txnId = this.nextTxnId++;
        doc.__txnId__ = txnId;

        if (doc.__deleted__) doc.__lsn__ = this.walLsn.toString();

        const binaryData = packr.pack(doc);
        const idBuffer   = Buffer.from(doc._id);
        await this.writeWalRecord(idBuffer, binaryData, txnId);
        this.committedTxnId = txnId > this.committedTxnId ? txnId : this.committedTxnId;

        const oldest  = this.snapshotRegistry.oldest();
        const prevBuf = this.memtable.get(doc._id, this.committedTxnId);
        const prevDoc = prevBuf ? packr.unpack(prevBuf) as NovaDocument : null;
        this.memtable.set(doc._id, txnId, binaryData, oldest);

        for (const idx of this.secondaryIndexes.values()) {
            const newVal = readField(doc, idx.field);
            const oldVal = prevDoc ? readField(prevDoc, idx.field) : null;
            if (newVal !== undefined && newVal !== null)
                await this.updateSecondaryIndex(idx, String(newVal), doc._id,
                    oldVal !== undefined && oldVal !== null ? String(oldVal) : null);
        }

        if (this.memtable.byteSize >= this.config.memtableLimitBytes) {
            if (this.immutableQueue.length >= this.config.maxImmutableMemtables)
                await this.waitForImmutableSlot();
            await this.triggerBackgroundFlush();
        }
        return doc._id;
    }

    async delete(id: string): Promise<boolean> {
        await this.upsert({ _id: id, __deleted__: true });
        return true;
    }

    private async waitForImmutableSlot(): Promise<void> {
        while (this.immutableQueue.length >= this.config.maxImmutableMemtables)
            await new Promise(r => setTimeout(r, 5));
    }

    private async triggerBackgroundFlush() {
        const toFlush = this.memtable;
        this.memtable = new SortedMemtable();
        this.immutableQueue.push(toFlush);

        if (this.walFd) {
            await this.flushWal();
            await this.walFd.close();
        }

        const sstableId       = this.nextSstableId++;
        const activeWalPath   = path.join(this.collectionDir, 'active.wal');
        const flushingWalPath = path.join(
            this.collectionDir, `flushing_${sstableId.toString().padStart(5, '0')}.wal`,
        );
        await fs.rename(activeWalPath, flushingWalPath);
        this.walFd = await fs.open(activeWalPath, 'a');

        const sstablePath = path.join(
            this.collectionDir, `sstable_${sstableId.toString().padStart(5, '0')}.dat`,
        );
        const flushLsn   = this.walLsn;
        const oldestSnap = this.snapshotRegistry.oldest();
        const hasSnaps   = this.snapshotRegistry.hasAny();

        const runFlush = async (attempt: number): Promise<void> => {
            try {
                let flushMap: Map<string, Buffer>;
                if (hasSnaps) {
                    const entries = toFlush.toFlushEntries(oldestSnap, true);
                    flushMap = new Map(entries);
                } else {
                    flushMap = toFlush.toMap();
                }

                const metadata = await this.writeSSTableFile(flushMap, sstableId, sstablePath, 0);

                this.levels[0] = [metadata, ...this.levels[0]];
                this.invalidateSstablesCache();

                const idx = this.immutableQueue.indexOf(toFlush);
                if (idx !== -1) this.immutableQueue.splice(idx, 1);

                await this.appendManifest({
                    type: MANIFEST_FLUSH, lsn: flushLsn.toString(),
                    sstableId, level: 0, timestamp: Date.now(),
                });

                await fs.unlink(flushingWalPath).catch(() => {});

                if (this.levels[0].length >= (this.config.l0CompactionThreshold ?? 4))
                    await this.triggerLeveledCompaction(0);
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                log.error(`Background flush error (attempt ${attempt}): ${error.message}`, {
                    stack: error.stack,
                });
                const delay = Math.min(30_000, 500 * attempt);
                setTimeout(() => { void runFlush(attempt + 1); }, delay).unref();
            }
        };
        setImmediate(() => { void runFlush(1); });
    }

    private async writeSSTableFile(
        table:    Map<string, Buffer>,
        id:       number,
        filePath: string,
        level:    number,
    ): Promise<SSTableMetadata> {
        const sortedKeys     = Array.from(table.keys()).sort();
        const actualKeyCount = sortedKeys.length;
        const plainKeyCount  = sortedKeys.filter(k => !isVersionedKey(k)).length;
        const bloom          = new BloomFilter({ expectedItems: Math.max(plainKeyCount, 1) });
        const sparseIndex: SparseIndex = [];

        const tempPath = filePath + '.tmp';
        const ws       = createWriteStream(tempPath);
        const write    = (buf: Buffer): Promise<void> =>
            new Promise((res, rej) => ws.write(buf, e => e ? rej(e) : res()));

        let currentOffset     = 0;
        let lastBlockBoundary = -this.config.blockSize;

        for (const key of sortedKeys) {
            if (isVersionedKey(key)) {
                const { id: realId } = decodeVersionedKey(key);
                bloom.add(realId);
            } else {
                bloom.add(key);
            }

            const rawData = table.get(key)!;
            const idBuf   = Buffer.from(key);

            let docBuf = rawData, flags = 0x00;
            if (this.config.blockCompression) {
                const comp = deflateRawSync(rawData, { level: 1 });
                if (comp.length < rawData.length) { docBuf = comp; flags = 0x01; }
            }

            if (currentOffset - lastBlockBoundary >= this.config.blockSize) {
                sparseIndex.push([key, currentOffset]);
                lastBlockBoundary = currentOffset;
            }

            const checksum = crc32c(Buffer.concat([idBuf, rawData]));
            const hdr = Buffer.alloc(RECORD_HEADER_SIZE);
            hdr.writeUInt16BE(idBuf.length, 0);
            hdr.writeUInt32BE(docBuf.length, 2);
            hdr.writeUInt32BE(checksum, 6);
            hdr.writeUInt8(flags, 10);

            const record = Buffer.concat([hdr, idBuf, docBuf]);
            await write(record);
            currentOffset += record.length;
        }

        const indexOffset     = currentOffset;
        const serializedIndex = packr.pack(sparseIndex);
        await write(serializedIndex);

        const bloomOffset = indexOffset + serializedIndex.length;
        await write(bloom.bitArray);

        const trailer = Buffer.alloc(FOOTER_SIZE);
        trailer.writeBigUInt64BE(BigInt(indexOffset),  0);
        trailer.writeBigUInt64BE(BigInt(bloomOffset),  8);
        trailer.writeUInt32BE(bloom.size,             16);
        trailer.writeUInt16BE(bloom.hashCount,        20);
        trailer.writeUInt16BE(FOOTER_MAGIC,           22);
        trailer.writeUInt32BE(FOOTER_VERSION,         24);
        trailer.writeUInt32BE(actualKeyCount,         28);
        await write(trailer);

        await new Promise<void>((res, rej) => ws.end((e: Error | null | undefined) => e ? rej(e) : res()));
        await fs.rename(tempPath, filePath);

        const stat   = await fs.stat(filePath);
        const minKey = sortedKeys.length > 0 ? sortedKeys[0] : '';
        const maxKey = sortedKeys.length > 0 ? sortedKeys[sortedKeys.length - 1] : '';

        return {
            id, level, index: sparseIndex, bloom, filePath,
            minKey, maxKey, keyCount: actualKeyCount, sizeBytes: stat.size,
        };
    }

    private async triggerLeveledCompaction(level: number) {
        if (this.isCompacting) return;
        this.isCompacting = true;
        try {
            await this.runLeveledCompaction(level);
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            log.error(`Leveled compaction error at L${level}: ${error.message}`, {
                stack: error.stack,
            });
        } finally {
            this.isCompacting = false;
        }
    }

    private levelTargetBytes(level: number): number {
        const l1  = this.config.l1MaxBytes    ?? 256 * 1024 * 1024;
        const mul = this.config.levelSizeMultiplier ?? 10;
        if (level === 0) return 0;
        return l1 * Math.pow(mul, level - 1);
    }

    private async runLeveledCompaction(level: number) {
        const nextLevel = level + 1;
        if (nextLevel >= this.levels.length) return;

        let inputsThisLevel: SSTableMetadata[];
        if (level === 0) {
            inputsThisLevel = [...this.levels[0]];
        } else {
            const levelTotal = this.levels[level].reduce((s, t) => s + t.sizeBytes, 0);
            if (levelTotal <= this.levelTargetBytes(level)) return;
            inputsThisLevel = [[...this.levels[level]].sort((a, b) => b.sizeBytes - a.sizeBytes)[0]];
        }

        if (inputsThisLevel.length === 0) return;

        const minKey = inputsThisLevel.reduce((m, t) => t.minKey < m ? t.minKey : m, inputsThisLevel[0].minKey);
        const maxKey = inputsThisLevel.reduce((m, t) => t.maxKey > m ? t.maxKey : m, inputsThisLevel[0].maxKey);

        const overlappingNext = this.levels[nextLevel].filter(
            t => !(t.maxKey < minKey || t.minKey > maxKey),
        );

        const allInputs = [...inputsThisLevel, ...overlappingNext].sort((a, b) => a.id - b.id);
        const isBottommost   = this.isBottommostLevel(nextLevel, minKey, maxKey);
        const targetFileSize = this.config.targetFileSizeBytes ?? 64 * 1024 * 1024;

        const newMetadatas = await this.compactSSTablesStreaming(
            allInputs, this.collectionDir, nextLevel, isBottommost, targetFileSize,
        );

        const removedIds = new Set(allInputs.map(t => t.id));
        this.levels[level]     = this.levels[level].filter(t => !removedIds.has(t.id));
        this.levels[nextLevel] = [
            ...newMetadatas,
            ...this.levels[nextLevel].filter(t => !removedIds.has(t.id)),
        ];
        if (nextLevel > 0)
            this.levels[nextLevel].sort((a, b) => a.minKey < b.minKey ? -1 : 1);

        this.invalidateSstablesCache();

        await this.appendManifest({
            type: MANIFEST_COMPACT, removedIds: [...removedIds],
            addedIds: newMetadatas.map(m => m.id), addedLevel: nextLevel,
            timestamp: Date.now(),
        });

        for (const old of allInputs) {
            await this.tableCache.evict(old.filePath);
            this.blockCache.invalidate(old.filePath + ':');
            await fs.unlink(old.filePath).catch(() => {});
        }

        const nextTotal = this.levels[nextLevel].reduce((s, t) => s + t.sizeBytes, 0);
        if (nextLevel < this.levels.length - 1 && nextTotal > this.levelTargetBytes(nextLevel))
            await this.runLeveledCompaction(nextLevel);
    }

    private isBottommostLevel(level: number, minKey: string, maxKey: string): boolean {
        for (let l = level + 1; l < this.levels.length; l++)
            for (const t of this.levels[l])
                if (!(t.maxKey < minKey || t.minKey > maxKey)) return false;
        return true;
    }

    private async compactSSTablesStreaming(
        tables:             SSTableMetadata[],
        outDir:             string,
        outputLevel:        number,
        isBottommost:       boolean,
        targetFileSizeBytes: number,
    ): Promise<SSTableMetadata[]> {
        const gcCutoffTxnId = this.snapshotRegistry.oldest();
        const rateLimiter   = new RateLimiter(this.config.compactionRateLimitBytesPerSec);
        const estimatedKeys = tables.reduce((s, t) => s + t.keyCount, 0);

        const iterators: SSTableIterator[] = tables.map(
            (t, i) => new SSTableIterator(t.filePath, this.config, tables.length - 1 - i, undefined, undefined, t),
        );
        await Promise.all(iterators.map(async it => { await it.open(); await it.advance(); }));

        const heap = new MergeHeap();
        for (const it of iterators) { if (it.key !== null) heap.push(it); }

        const results: SSTableMetadata[] = [];

        const openOutput = async () => {
            const id       = this.nextSstableId++;
            const filePath = path.join(outDir, `sstable_${id.toString().padStart(5, '0')}.dat`);
            const tempPath = filePath + '.tmp';
            const ws       = createWriteStream(tempPath);
            const write    = (buf: Buffer): Promise<void> =>
                new Promise((res, rej) => ws.write(buf, e => e ? rej(e) : res()));
            const bloom       = new BloomFilter({ expectedItems: Math.max(Math.ceil(estimatedKeys / Math.max(tables.length, 1)), 1) });
            const sparseIndex: SparseIndex = [];
            return { id, filePath, tempPath, ws, write, bloom, sparseIndex,
                     currentOffset: 0, lastBlockBoundary: -this.config.blockSize, keyCount: 0 };
        };

        type OutputCtx = Awaited<ReturnType<typeof openOutput>>;

        const finalizeOutput = async (ctx: OutputCtx): Promise<SSTableMetadata> => {
            const { write, ws, bloom, sparseIndex, currentOffset, filePath, tempPath, id, keyCount } = ctx;
            const indexOffset     = currentOffset;
            const serializedIndex = packr.pack(sparseIndex);
            await write(serializedIndex);
            const bloomOffset = indexOffset + serializedIndex.length;
            await write(bloom.bitArray);

            const trailer = Buffer.alloc(FOOTER_SIZE);
            trailer.writeBigUInt64BE(BigInt(indexOffset), 0);
            trailer.writeBigUInt64BE(BigInt(bloomOffset), 8);
            trailer.writeUInt32BE(bloom.size,             16);
            trailer.writeUInt16BE(bloom.hashCount,       20);
            trailer.writeUInt16BE(FOOTER_MAGIC,          22);
            trailer.writeUInt32BE(FOOTER_VERSION,        24);
            trailer.writeUInt32BE(keyCount,              28);
            await write(trailer);
            await new Promise<void>((res, rej) => ws.end((e: Error | null | undefined) => e ? rej(e) : res()));
            await fs.rename(tempPath, filePath);

            const stat   = await fs.stat(filePath);
            const minKey = sparseIndex.length > 0 ? sparseIndex[0][0] : '';
            const maxKey = sparseIndex.length > 0 ? sparseIndex[sparseIndex.length - 1][0] : '';
            return { id, level: outputLevel, index: sparseIndex, bloom, filePath,
                     minKey, maxKey, keyCount, sizeBytes: stat.size };
        };

        let cur     = await openOutput();
        let lastKey: string | null = null;

        while (heap.size > 0) {
            const winner = heap.pop()!;
            const key    = winner.key!;
            const value  = winner.value!;

            await winner.advance();
            if (winner.key !== null) heap.push(winner);

            if (key === lastKey) continue;
            lastKey = key;

            await rateLimiter.consume(value.length);

            if (isVersionedKey(key)) {
                const { txnId } = decodeVersionedKey(key);
                if (txnId < gcCutoffTxnId) continue; 
            }

            const doc = packr.unpack(value) as NovaDocument;

            if (doc.__deleted__ && isBottommost && !isVersionedKey(key)) continue;

            const realKey = isVersionedKey(key) ? decodeVersionedKey(key).id : key;
            cur.bloom.add(realKey);

            const idBuf   = Buffer.from(key);
            const rawData = value;

            let docBuf = rawData, flags = 0x00;
            if (this.config.blockCompression) {
                const comp = deflateRawSync(rawData, { level: 1 });
                if (comp.length < rawData.length) { docBuf = comp; flags = 0x01; }
            }

            if (cur.currentOffset - cur.lastBlockBoundary >= this.config.blockSize) {
                cur.sparseIndex.push([key, cur.currentOffset]);
                cur.lastBlockBoundary = cur.currentOffset;
            }

            const checksum = crc32c(Buffer.concat([idBuf, rawData]));
            const hdr = Buffer.alloc(RECORD_HEADER_SIZE);
            hdr.writeUInt16BE(idBuf.length, 0);
            hdr.writeUInt32BE(docBuf.length, 2);
            hdr.writeUInt32BE(checksum, 6);
            hdr.writeUInt8(flags, 10);

            const record = Buffer.concat([hdr, idBuf, docBuf]);
            await cur.write(record);
            cur.currentOffset += record.length;
            cur.keyCount++;
            await rateLimiter.consume(record.length);

            if (cur.currentOffset >= targetFileSizeBytes) {
                results.push(await finalizeOutput(cur));
                cur = await openOutput();
            }
        }

        if (cur.keyCount > 0 || results.length === 0)
            results.push(await finalizeOutput(cur));

        return results;
    }

    async get(id: string, snapshot?: bigint): Promise<NovaDocument | null> {
        const snap = snapshot ?? this.committedTxnId;

        const buf = this.memtable.get(id, snap);
        if (buf) {
            const doc = packr.unpack(buf) as NovaDocument;
            return doc.__deleted__ ? null : doc;
        }

        for (let i = this.immutableQueue.length - 1; i >= 0; i--) {
            const ibuf = this.immutableQueue[i].get(id, snap);
            if (ibuf) {
                const doc = packr.unpack(ibuf) as NovaDocument;
                return doc.__deleted__ ? null : doc;
            }
        }

        for (const sstable of this.sstables) {
            if (!sstable.bloom.check(id)) continue;
            try {
                const doc = await this.readRecordFromDisk(sstable, id);
                if (doc !== undefined && this.visibleTo(doc, snap)) {
                    return doc.__deleted__ ? null : doc;
                }
                
                const versionedDoc = await this.readVersionedFromDisk(sstable, id, snap);
                if (versionedDoc !== undefined) {
                    return versionedDoc.__deleted__ ? null : versionedDoc;
                }
            } catch (err: unknown) {
                if (isEnoent(err)) continue;
                throw err;
            }
        }
        return null;
    }

    private async readVersionedFromDisk(
        sstable: SSTableMetadata, id: string, snap: bigint,
    ): Promise<NovaDocument | undefined> {
        const bestVersionedKey = encodeVersionedKey(id, snap);
        
        let startOffset = 0;
        let prevOffset  = 0;
        for (let i = 0; i < sstable.index.length; i++) {
            if (sstable.index[i][0] <= bestVersionedKey) {
                prevOffset = startOffset;
                startOffset = sstable.index[i][1];
            } else {
                break;
            }
        }
        
        const actualStartOffset = prevOffset;

        const fd = await this.tableCache.get(sstable.filePath);
        const stat      = await fd.stat();
        const footerBuf = Buffer.alloc(FOOTER_SIZE);
        await fd.read(footerBuf, 0, FOOTER_SIZE, stat.size - FOOTER_SIZE);
        const indexOffset = Number(footerBuf.readBigUInt64BE(0));

        let blockEnd = indexOffset;
        for (const [, off] of sstable.index)
            if (off > actualStartOffset) { blockEnd = off; break; }

        const blockSize = blockEnd - actualStartOffset;
        const blockData = Buffer.alloc(blockSize);
        await fd.read(blockData, 0, blockSize, actualStartOffset);

        let bestDoc: NovaDocument | undefined;
        let bestTxn = -1n;
        let pos = 0;

        while (pos + RECORD_HEADER_SIZE <= blockData.length) {
            const keyLen    = blockData.readUInt16BE(pos);
            const docLen    = blockData.readUInt32BE(pos + 2);
            const storedCrc = blockData.readUInt32BE(pos + 6);
            const flags     = blockData.readUInt8(pos + 10);
            pos += RECORD_HEADER_SIZE;

            if (pos + keyLen + docLen > blockData.length) break;

            const key    = blockData.toString('utf-8', pos, pos + keyLen);
            const keyBuf = blockData.subarray(pos, pos + keyLen);
            pos += keyLen;
            const docBuf = blockData.subarray(pos, pos + docLen);
            pos += docLen;

            if (key >= id && !isVersionedKey(key)) break;

            if (!isVersionedKey(key)) continue;
            const { id: vId, txnId: vTxnId } = decodeVersionedKey(key);
            if (vId !== id) continue;
            if (vTxnId > snap) continue;

            const decompDoc = (flags & 0x01) ? inflateRawSync(docBuf) : docBuf;
            const actualCrc = crc32c(Buffer.concat([keyBuf, decompDoc]));
            if (actualCrc !== storedCrc) continue;

            if (vTxnId > bestTxn) {
                bestTxn = vTxnId;
                bestDoc = packr.unpack(decompDoc) as NovaDocument;
            }
        }

        return bestDoc;
    }

    private visibleTo(doc: NovaDocument, snapshot: bigint): boolean {
        if (doc.__txnId__ === undefined) return true;
        return asBigInt(doc.__txnId__) <= snapshot;
    }

    private async readRecordFromDisk(sstable: SSTableMetadata, targetId: string): Promise<NovaDocument | undefined> {
        const blockOffset = sparseIndexLookup(sstable.index, targetId);
        const cacheKey    = `${sstable.filePath}:${blockOffset}`;

        let blockData = this.blockCache.get(cacheKey);
        if (!blockData) {
            const fd         = await this.tableCache.get(sstable.filePath);
            const stat       = await fd.stat();
            const footerBuf  = Buffer.alloc(FOOTER_SIZE);
            await fd.read(footerBuf, 0, FOOTER_SIZE, stat.size - FOOTER_SIZE);
            const indexOffset = Number(footerBuf.readBigUInt64BE(0));

            let blockEnd = indexOffset;
            for (const [, off] of sstable.index)
                if (off > blockOffset) { blockEnd = off; break; }

            const blockSize = blockEnd - blockOffset;
            blockData = Buffer.alloc(blockSize);
            await fd.read(blockData, 0, blockSize, blockOffset);
            this.blockCache.set(cacheKey, blockData);
        }

        let pos = 0;
        while (pos + RECORD_HEADER_SIZE <= blockData.length) {
            const keyLen    = blockData.readUInt16BE(pos);
            const docLen    = blockData.readUInt32BE(pos + 2);
            const storedCrc = blockData.readUInt32BE(pos + 6);
            const flags     = blockData.readUInt8(pos + 10);
            pos += RECORD_HEADER_SIZE;

            if (pos + keyLen + docLen > blockData.length) break;

            const key = blockData.toString('utf-8', pos, pos + keyLen);
            pos += keyLen;
            const docBuf = blockData.subarray(pos, pos + docLen);
            pos += docLen;

            if (key === targetId) {
                const keyBuf    = Buffer.from(key);
                const decompDoc = (flags & 0x01) ? inflateRawSync(docBuf) : docBuf;
                const actualCrc = crc32c(Buffer.concat([keyBuf, decompDoc]));
                if (actualCrc !== storedCrc)
                    throw new Error(`[NovaDB] Checksum mismatch for key "${key}" — corruption detected`);
                return packr.unpack(decompDoc) as NovaDocument;
            }
            if (key > targetId) break;
        }
        return undefined;
    }

    async *scan(fromId: string, toId: string, snapshot?: bigint): AsyncGenerator<NovaDocument> {
        const snap = snapshot ?? this.committedTxnId;

        const iterators: KVIterator[] = [];
        let prio = 0;

        const memIter = new MemtableIterator(this.memtable, prio++, snap, fromId, toId);
        await memIter.advance();
        iterators.push(memIter);

        for (let i = this.immutableQueue.length - 1; i >= 0; i--) {
            const iter = new MemtableIterator(this.immutableQueue[i], prio++, snap, fromId, toId);
            await iter.advance();
            iterators.push(iter);
        }

        for (const t of this.sstables) {
            if (t.maxKey !== '' && t.maxKey < fromId) continue;
            if (t.minKey !== '' && t.minKey > toId)   continue;
            const it = new SSTableIterator(t.filePath, this.config, prio++, fromId, toId, t);
            await it.open();
            await it.advance();
            iterators.push(it);
        }

        const heap = new MergeHeap();
        for (const it of iterators) { if (it.key !== null) heap.push(it); }

        let lastEmittedKey: string | null = null;
        let lastSeenKey:    string | null = null;

        while (heap.size > 0) {
            const winner = heap.pop()!;
            const key    = winner.key!;
            const value  = winner.value!;

            await winner.advance();
            if (winner.key !== null) heap.push(winner);

            if (isVersionedKey(key)) continue;
            if (key === lastEmittedKey) continue;

            const doc = packr.unpack(value) as NovaDocument;

            if (key === lastSeenKey) {
                if (!this.visibleTo(doc, snap)) continue;
                if (!doc.__deleted__) { lastEmittedKey = key; yield doc; }
                else                  { lastEmittedKey = key; }
                continue;
            }

            lastSeenKey = key;

            if (!this.visibleTo(doc, snap)) {
                for (const sstable of this.sstables) {
                    if (!sstable.bloom.check(key)) continue;
                    try {
                        const vDoc = await this.readVersionedFromDisk(sstable, key, snap);
                        if (vDoc !== undefined) {
                            if (!vDoc.__deleted__) { lastEmittedKey = key; yield vDoc; }
                            else                   { lastEmittedKey = key; }
                        }
                    } catch {  }
                    if (lastEmittedKey === key) break;
                }
                continue;
            }

            if (!doc.__deleted__) { lastEmittedKey = key; yield doc; }
            else                  { lastEmittedKey = key; }
        }

        for (const it of iterators) {
            if (
                it !== null &&
                typeof it === 'object' &&
                'close' in it &&
                typeof (it as { close?: unknown }).close === 'function'
            ) {
                const closer = (it as { close: () => Promise<void> | void }).close;
                try {
                    await closer.call(it);
                } catch {
                }
            }
        }
    }
}

export class NovaDB {
    private collections = new Map<string, NovaCollection>();
    private readonly config: NovaConfig;

    constructor(config: NovaConfig) { this.config = config; }

    async collection(name: string): Promise<NovaCollection> {
        if (this.collections.has(name)) return this.collections.get(name)!;
        const coll = new NovaCollection(name, this.config);
        await coll.boot();
        this.collections.set(name, coll);
        return coll;
    }

    async close() {
        for (const coll of this.collections.values()) await coll.close();
        this.collections.clear();
    }
}