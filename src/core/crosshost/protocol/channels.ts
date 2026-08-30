export function channelSnapshotNotify(prefix: string): string {
    return `${prefix}:snapshot:notify`;
}

export function channelAssignmentUpdate(prefix: string): string {
    return `${prefix}:assignment:update`;
}

export function channelIdentifyGrant(prefix: string): string {
    return `${prefix}:identify:grant`;
}

export function channelHeartbeat(prefix: string): string {
    return `${prefix}:heartbeat`;
}

export function keySnapshotFull(prefix: string, version: number): string {
    return `${prefix}:snapshot:full:${version}`;
}

export function keySnapshotLatest(prefix: string): string {
    return `${prefix}:snapshot:latest`;
}

export function channelStats(prefix: string): string {
    return `${prefix}:stats`;
}

export function channelUpdateInstruct(prefix: string): string {
    return `${prefix}:update:instruct`;
}

export function channelUpdateAck(prefix: string): string {
    return `${prefix}:update:ack`;
}

export function channelQueryRequest(prefix: string): string {
    return `${prefix}:query:request`;
}

export function channelQueryResponse(prefix: string): string {
    return `${prefix}:query:response`;
}

export function channelPluginBus(prefix: string): string {
    return `${prefix}:plugin:bus`;
}

export function channelControlShutdown(prefix: string): string {
    return `${prefix}:control:shutdown`;
}
