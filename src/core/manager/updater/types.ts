export interface BaselineFileEntry {
    hash: string;
    size: number;
}

export interface Baseline {
    tag: string;
    commit: string;
    timestamp: string;
    files: Record<string, BaselineFileEntry>;
}

export interface PluginDecision {
    pluginId: string;
    localPath: string;
    remotePath: string | null;
    action: 'update' | 'leave' | 'add';
    reason: string;
    localManifestId?: string;
    remoteManifestId?: string;
}

export interface DirtyFile {
    path: string;
    baselineHash: string;
    currentHash: string;
    category: 'core' | 'plugin';
}

export interface UpdatePlan {
    fromTag: string | null;
    toTag: string;
    toCommit: string;
    allowed: boolean;
    reason: string;
    dirtyFiles: DirtyFile[];
    pluginDecisions: PluginDecision[];
    filesToOverwrite: string[];
    filesToAdd: string[];
    filesToKeep: string[];
    dryRun: boolean;
    baselineOnly: boolean;
}

export interface UpdaterConfig {
    autoUpdater: boolean;
    repositoryUrl: string | null;
    githubPat: string | null;
    defaultRepo: string;
    branch: string;
    devBuilds: boolean;
    safeUpdate: boolean;
    keepExtra: boolean;
    allowForce: boolean;
    dryRun: boolean;
    maxBackups: number;
    timeoutMs: number;
    postUpdateCmd: string | null;
    notifyChannel: string | null;
    pluginManifest: string;
    mode: 'standalone' | 'background';
}

export interface TagInfo {
    name: string;
    commit: string;
    semver: import('#core/utils/semver.js').SemVer | null;
}