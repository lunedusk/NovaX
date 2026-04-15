export class SemVer {
    public static satisfies(current: string, requirement: string): boolean {
        if (!requirement || requirement === '*' || requirement === 'any') return true;

        const [cMajor, cMinor, cPatch] = current.replace('v', '').split('.').map(Number);
        
        // Handle complex statements like ">=1.0.0 <2.0.0"
        const conditions = requirement.split(' ').map(s => s.trim()).filter(Boolean);

        for (const cond of conditions) {
            const match = cond.match(/^([<>=^~]+)?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
            if (!match) continue;

            const op = match[1] || '==';
            const rMaj = Number(match[2]);
            const rMin = match[3] !== undefined ? Number(match[3]) : 0;
            const rPat = match[4] !== undefined ? Number(match[4]) : 0;

            const isGreater = cMajor > rMaj || (cMajor === rMaj && (cMinor > rMin || (cMinor === rMin && cPatch > rPat)));
            const isEqual = cMajor === rMaj && cMinor === rMin && cPatch === rPat;

            switch (op) {
                case '>': if (!isGreater) return false; break;
                case '>=': if (!isGreater && !isEqual) return false; break;
                case '=>': if (!isGreater && !isEqual) return false; break;
                case '<': if (isGreater || isEqual) return false; break;
                case '<=': if (isGreater) return false; break;
                case '=<': if (isGreater) return false; break;
                case '==': 
                case '=': if (!isEqual) return false; break;
                case '^':
                    if (cMajor !== rMaj || (!isGreater && !isEqual)) return false;
                    break;
                case '~':
                    if (cMajor !== rMaj || cMinor !== rMin || cPatch < rPat) return false;
                    break;
            }
        }
        return true;
    }
}