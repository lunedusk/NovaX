import fs from 'node:fs';
import type { ServerOptions as HttpsServerOptions } from 'node:https';
import type { ConnectionOptions } from 'node:tls';
import type { CrossHostEnv } from '../types.js';

export interface MtlsMaterial {
    readonly serverOptions: HttpsServerOptions;
    readonly clientOptions: ConnectionOptions;
}

export function loadMtlsMaterial(env: CrossHostEnv): MtlsMaterial | null {
    if (!env.mtlsEnabled) return null;
    if (!env.mtlsCertPath || !env.mtlsKeyPath || !env.mtlsCaPath) {
        throw new Error(
            'CROSS_HOST_MTLS_ENABLED is true but CROSS_HOST_MTLS_CERT_PATH, CROSS_HOST_MTLS_KEY_PATH, and CROSS_HOST_MTLS_CA_PATH are all required',
        );
    }
    for (const p of [env.mtlsCertPath, env.mtlsKeyPath, env.mtlsCaPath]) {
        if (!fs.existsSync(p)) {
            throw new Error(`mTLS path does not exist: ${p}`);
        }
    }
    const cert = fs.readFileSync(env.mtlsCertPath);
    const key = fs.readFileSync(env.mtlsKeyPath);
    const ca = fs.readFileSync(env.mtlsCaPath);
    return {
        serverOptions: {
            cert,
            key,
            ca,
            requestCert: true,
            rejectUnauthorized: true,
        },
        clientOptions: {
            cert,
            key,
            ca,
            rejectUnauthorized: true,
        },
    };
}
