import { redisDB, ormDB, mongoDB, pgDB, sqliteDB, novaDB } from '#core/database/index.js';

export type DatabaseDomain = {
    readonly mongo: typeof mongoDB;
    readonly redis: typeof redisDB;
    readonly postgres: typeof pgDB;
    readonly orm: typeof ormDB;
    readonly sqlite: typeof sqliteDB;
    readonly nova: typeof novaDB;
};

export const dbDomain: DatabaseDomain = Object.freeze({
    mongo: mongoDB,
    redis: redisDB,
    postgres: pgDB,
    orm: ormDB,
    sqlite: sqliteDB,
    nova: novaDB
});