import winston from 'winston';
import 'winston-daily-rotate-file';
import util from 'util';
import fastRedact from 'fast-redact';
import { format } from './format.js';
import { secrets } from '#core/helpers/secretManager.js';

export type Logger = winston.Logger & {
    fatal: winston.LeveledLogMethod;
};

const isProd = process.env.NODE_ENV === 'production';
const LOG_TZ = secrets.getOptional('LogTZ') || 'UTC';
const DEFAULT_LEVEL = secrets.getOptional('LogLevel') || (isProd ? 'info' : 'debug');

const SESSION_ID = format.time.toTz(new Date(), LOG_TZ, 'YYYY-MM-DD_HH-mm-ss');

const CUSTOM_LEVELS = {
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
};

const LEVEL_COLORS: Record<string, string> = {
    debug: "\x1b[38;2;0;255;215m",
    info: "\x1b[38;2;255;255;255m",
    warn: "\x1b[38;2;255;255;0m",
    error: "\x1b[38;2;255;80;80m",
    fatal: "\x1b[48;2;180;0;0m\x1b[38;2;255;255;255m",
};

const redact = fastRedact({
    paths: ['*.password', '*.token', '*.secret', '*.authorization', '*.apiKey', '*.cookie'],
    censor: '[REDACTED]',
    serialize: false 
});

const redactFormat = winston.format((info) => {
    redact(info as Record<string, unknown>);
    return info;
});

const humanReadableFormat = winston.format.printf((info) => {
    const { level, message, timestamp, name, stack, metadata } = info;
    
    const colorize = info.colorize === true;
    const color = colorize ? (LEVEL_COLORS[level] || "") : "";
    const reset = colorize ? "\x1b[0m" : "";
    
    const modName = name || 'app';
    
    let msg = `[${timestamp}] [${color}${modName}${reset}] [${color}${level.toUpperCase()}${reset}] ${message}`;
    
    if (stack) {
        msg += `\n${color}${stack}${reset}`;
    }

    if (metadata && Object.keys(metadata).length > 0) {
        const inspected = util.inspect(metadata, { 
            depth: 3,
            colors: colorize,
            compact: false,
            breakLength: 80
        });
        msg += `\n  ↳ ${inspected}`;
    }
    
    return msg;
});

const sharedTransports = [
    new winston.transports.Console({ 
        format: winston.format.combine(
            redactFormat(),
            winston.format((info) => { info.colorize = true; return info; })(),
            humanReadableFormat
        )
    }),
    
    new winston.transports.DailyRotateFile({
        dirname: `logs/console/session-${SESSION_ID}`,
        filename: `%DATE%.log`,
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '50m',
        maxFiles: '14d',
        auditFile: 'logs/.audit/combined-audit.json',
        format: winston.format.combine(
            redactFormat(),
            winston.format.errors({ stack: true }),
            winston.format.uncolorize(),
            humanReadableFormat
        )
    }),

    new winston.transports.DailyRotateFile({
        level: 'error',
        dirname: `logs/console/error/session-${SESSION_ID}`,
        filename: `%DATE%-error.log`,
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d',
        auditFile: 'logs/.audit/error-audit.json',
        format: winston.format.combine(
            redactFormat(),
            winston.format.errors({ stack: true }),
            winston.format.uncolorize(),
            humanReadableFormat
        )
    })
];

const globalLogger = winston.createLogger({
    levels: CUSTOM_LEVELS,
    level: DEFAULT_LEVEL,
    exitOnError: false,
    format: winston.format.combine(
        winston.format.timestamp({ format: () => format.time.toTz(new Date(), LOG_TZ, 'YYYY-MM-DD HH:mm:ss.SSS Z') }),
        winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'name', 'stack'] })
    ),
    transports: sharedTransports
});

export async function flushLogs(): Promise<void> {
    return new Promise((resolve) => {
        globalLogger.end();
        let finished = 0;
        const transports = globalLogger.transports;
        const timer = setTimeout(() => {
            resolve();
        }, 1000);

        transports.forEach((t) => {
            t.once('finish', () => {
                finished++;
                if (finished >= transports.length) {
                    clearTimeout(timer);
                    resolve();
                }
            });
            
            if (typeof (t as any).end === 'function') {
                (t as any).end();
            }
        });

        if (transports.length === 0) resolve();
    });
}

export function getLogger(name: string = 'app', level: string = DEFAULT_LEVEL): Logger {
    const child = globalLogger.child({ name });
    child.level = level;
    return child as Logger;
}