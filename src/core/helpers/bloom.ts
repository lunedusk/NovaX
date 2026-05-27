import crypto from 'node:crypto';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('BloomFilter');

export class BloomFilter {
    private readonly bitArray: Buffer;
    private readonly size: number;
    private readonly hashes: number;
    private itemsAdded = 0;

    constructor(expectedItems: number = 10_000_000, falsePositiveRate: number = 0.01) {
        this.size = Math.ceil(-(expectedItems * Math.log(falsePositiveRate)) / (Math.log(2) ** 2));
        
        this.hashes = Math.ceil((this.size / expectedItems) * Math.log(2));
        
        this.bitArray = Buffer.alloc(Math.ceil(this.size / 8), 0);
        
        const mbSize = (this.bitArray.length / 1024 / 1024).toFixed(2);
        log.info(`[BloomFilter] Initialized: ${mbSize}MB allocated | Hashes: ${this.hashes}`);
    }

    private getHashPositions(item: string): number[] {
        const hash = crypto.createHash('md5').update(item).digest();
        const h1 = hash.readUInt32LE(0);
        const h2 = hash.readUInt32LE(4);

        const positions: number[] = [];
        for (let i = 0; i < this.hashes; i++) {
            const pos = Math.abs((h1 + i * h2) % this.size);
            positions.push(pos);
        }
        return positions;
    }

    public add(item: string): void {
        const positions = this.getHashPositions(item);
        for (const pos of positions) {
            const byteIndex = Math.floor(pos / 8);
            const bitIndex = pos % 8;
            this.bitArray[byteIndex] |= (1 << bitIndex);
        }
        this.itemsAdded++;
    }

    public mightContain(item: string): boolean {
        const positions = this.getHashPositions(item);
        for (const pos of positions) {
            const byteIndex = Math.floor(pos / 8);
            const bitIndex = pos % 8;
            if ((this.bitArray[byteIndex] & (1 << bitIndex)) === 0) {
                return false;
            }
        }
        return true; 
    }

    public getStats() {
        return {
            itemsAdded: this.itemsAdded,
            capacity: this.size,
            memoryMb: (this.bitArray.length / 1024 / 1024).toFixed(2)
        };
    }
}