import { redisDB, ormDB, mongoDB, pgDB } from '#core/database/index.js';

export type DatabaseDomain = {
    readonly mongo: typeof mongoDB;
    readonly redis: typeof redisDB;
    readonly postgres: typeof pgDB;
    readonly sqlite: typeof ormDB;
};

export const dbDomain: DatabaseDomain = Object.freeze({
    mongo: mongoDB,
    redis: redisDB,
    postgres: pgDB,
    sqlite: ormDB
});