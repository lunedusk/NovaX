import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

// The exact root-level directories/files that make up the "Core" framework
const CORE_ARTIFACTS = ['core', 'scripts', 'index.js', 'index.d.ts', 'package.json', 'boot.js'];

/**
 * Reads the .novaxignore file to skip local/volatile files (like logs, .env) 
 * so the hash remains identical across different machines.
 */
async function getIgnoreList(baseDir: string): Promise<Set<string>> {
    // Default ignores to protect the user
    const ignoreSet = new Set<string>(['.env', 'logs', '.data', 'backups', 'node_modules', '.git', 'src']);
    const ignorePath = path.join(baseDir, '.novaxignore');
    
    if (existsSync(ignorePath)) {
        const content = await fs.readFile(ignorePath, 'utf-8');
        content.split('\n').map(line => line.trim()).forEach(line => {
            if (line && !line.startsWith('#')) ignoreSet.add(line);
        });
    }
    return ignoreSet;
}

/**
 * Recursively hashes a directory or file in a strict alphabetical order
 * to guarantee the resulting string is 100% deterministic.
 */
export async function hashDirectoryOrFile(targetPath: string, baseDir: string, ignoreSet: Set<string>): Promise<string[]> {
    const fileHashes: string[] = [];
    const stats = await fs.stat(targetPath).catch(() => null);
    
    if (!stats) return fileHashes;

    // Normalize slashes for cross-platform consistency (Windows vs Linux)
    const relative = path.relative(baseDir, targetPath).replace(/\\/g, '/');
    
    if (ignoreSet.has(relative) || ignoreSet.has(path.basename(targetPath))) {
        return fileHashes;
    }

    if (stats.isFile()) {
        const buffer = await fs.readFile(targetPath);
        const hash = createHash('sha256').update(buffer).digest('hex');
        fileHashes.push(`${relative}:${hash}`);
    } else if (stats.isDirectory()) {
        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        
        // CRITICAL: Sort alphabetically so Linux and Windows read files in the exact same order
        entries.sort((a, b) => a.name.localeCompare(b.name));
        
        for (const entry of entries) {
            const subHashes = await hashDirectoryOrFile(path.join(targetPath, entry.name), baseDir, ignoreSet);
            fileHashes.push(...subHashes);
        }
    }
    return fileHashes;
}

/**
 * The main generator function. Pass 'core' to hash the main framework,
 * or 'plugin' along with the folder name to hash a specific plugin.
 */
export async function generateMasterHash(baseDir: string, targetType: 'core' | 'plugin', pluginFolderName?: string): Promise<string> {
    const ignoreSet = await getIgnoreList(baseDir);
    const compiledEntries: string[] = [];

    if (targetType === 'core') {
        for (const artifact of CORE_ARTIFACTS) {
            const targetPath = path.join(baseDir, artifact);
            const subHashes = await hashDirectoryOrFile(targetPath, baseDir, ignoreSet);
            compiledEntries.push(...subHashes);
        }
    } else if (targetType === 'plugin' && pluginFolderName) {
        const pluginPath = path.join(baseDir, 'plugins', pluginFolderName);
        const subHashes = await hashDirectoryOrFile(pluginPath, baseDir, ignoreSet);
        compiledEntries.push(...subHashes);
    }

    // Final sort of all collected file hashes to ensure absolute determinism
    compiledEntries.sort();
    
    // Hash the massive string of all individual file hashes
    return createHash('sha256').update(compiledEntries.join('\n')).digest('hex');
}

// --- CLI Execution Block ---
// This allows you to run the file directly from the terminal to get your hashes before a release.
if (process.argv[1] === import.meta.url || process.argv[1].endsWith('generateFrameworkHash.ts')) {
    const type = (process.argv[2] || 'core') as 'core' | 'plugin';
    const pluginName = process.argv[3];
    
    console.log(`Scanning NovaX [${type}] structure...`);
    
    generateMasterHash(process.cwd(), type, pluginName)
        .then(hash => {
            console.log(`\n✅ Deterministic Hash (${type}${pluginName ? ':' + pluginName : ''}):\n${hash}\n`);
        })
        .catch(err => {
            console.error('\n❌ Failed to generate hash:', err);
        });
}