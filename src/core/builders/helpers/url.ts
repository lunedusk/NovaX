export function isValidUrl(url: string): boolean {
    return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("attachment://");
}

export function attachmentNameFromUrl(url: string): string | null {
    if (!url.startsWith("attachment://")) return null;
    const name = url.slice("attachment://".length);
    return name.length > 0 ? name : null;
}