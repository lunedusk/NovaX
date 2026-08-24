import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('DependencyLoader');

export class DependencyLoader {
    public static async installFromPackageJson(pluginDir: string, pluginId: string): Promise<void> {
        const pkgPath = path.join(pluginDir, 'package.json');

        try {
            const rawPkg = await fs.readFile(pkgPath, 'utf-8');
            const pkg = JSON.parse(rawPkg);

            const hasDependencies = pkg.dependencies && Object.keys(pkg.dependencies).length > 0;

            if (!hasDependencies) {
                log.debug(`[${pluginId}] No external dependencies defined in package.json.`);
                return;
            }

            const depCount = Object.keys(pkg.dependencies).length;
            log.info(`[${pluginId}] Found package.json. Installing ${depCount} dependencies in sandbox...`);

            await this.runNpmInstall(pluginDir, pluginId);
            log.info(`[${pluginId}] Dependencies successfully sandboxed.`);

        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;

            if (err.code === 'ENOENT') {
                log.debug(`[${pluginId}] No package.json found. Skipping npm install.`);
            } else if (err instanceof SyntaxError) {
                log.error(`[${pluginId}] package.json is malformed or invalid JSON.`);
                throw err;
            } else {
                log.error(`[${pluginId}] Failed to process package.json: ${err.message}`);
                throw err;
            }
        }
    }

    private static runNpmInstall(targetDir: string, pluginId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--prefer-offline'], {
                cwd: targetDir,
                stdio: 'ignore',
                shell: process.platform === 'win32',
                detached: process.platform !== 'win32'
            });

            const killTree = () => {
                try {
                    if (process.platform !== 'win32' && child.pid) {
                        process.kill(-child.pid, 'SIGTERM');
                    } else {
                        child.kill('SIGTERM');
                    }
                } catch {
                    try { child.kill('SIGKILL'); } catch { /* ignore */ }
                }
            };

            const timeout = setTimeout(() => {
                killTree();
                reject(new Error(`NPM Install timed out for plugin: ${pluginId}`));
            }, 120000);

            child.on('close', (code) => {
                clearTimeout(timeout);
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`NPM Install failed with exit code ${code} for plugin: ${pluginId}`));
                }
            });

            child.on('error', (err) => {
                clearTimeout(timeout);
                reject(new Error(`Failed to spawn NPM process: ${err.message}`));
            });
        });
    }
}
