export function truncateAtom(text: string, max: number): string {
    if (text.length <= max) return text;
    if (max <= 3) return text.slice(0, max);
    return `${text.slice(0, max - 3)}...`;
}

export function joinPageLines(lines: readonly string[]): string {
    return lines.join('\n');
}
