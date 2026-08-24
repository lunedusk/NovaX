export type RangeInput = string | readonly string[];

export interface SemVerSatisfiesOptions {
  includePrerelease?: boolean;
}

export class SemVer {
  public readonly major: number;
  public readonly minor: number;
  public readonly patch: number;
  public readonly prerelease: readonly string[];

  public constructor(
    major: number,
    minor: number = 0,
    patch: number = 0,
    prerelease: readonly string[] = [],
  ) {
    if (!Number.isInteger(major) || major < 0) {
      throw new Error(`Invalid major version: ${major}`);
    }
    if (!Number.isInteger(minor) || minor < 0) {
      throw new Error(`Invalid minor version: ${minor}`);
    }
    if (!Number.isInteger(patch) || patch < 0) {
      throw new Error(`Invalid patch version: ${patch}`);
    }
    this.major = major;
    this.minor = minor;
    this.patch = patch;
    this.prerelease = Object.freeze([...prerelease]);
  }

  public static parse(input: string): SemVer {
    if (!input) {
      throw new Error('Version string is empty');
    }
    const normalized = input.trim().replace(/^v/i, '');
    const match = normalized.match(
      /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
    );
    if (!match) {
      throw new Error(`Invalid semver string: "${input}"`);
    }
    const major = Number(match[1]);
    const minor = match[2] !== undefined ? Number(match[2]) : 0;
    const patch = match[3] !== undefined ? Number(match[3]) : 0;
    const prerelease =
      match[4] !== undefined && match[4].length > 0
        ? match[4].split('.').filter(Boolean)
        : [];
    return new SemVer(major, minor, patch, prerelease);
  }

  public toString(): string {
    const base = `${this.major}.${this.minor}.${this.patch}`;
    if (this.prerelease.length === 0) return base;
    return `${base}-${this.prerelease.join('.')}`;
  }

  public get hasPrerelease(): boolean {
    return this.prerelease.length > 0;
  }

  public compare(other: SemVer): number {
    if (this.major !== other.major) return this.major < other.major ? -1 : 1;
    if (this.minor !== other.minor) return this.minor < other.minor ? -1 : 1;
    if (this.patch !== other.patch) return this.patch < other.patch ? -1 : 1;
    return comparePrerelease(this.prerelease, other.prerelease);
  }

  public isEqual(other: SemVer): boolean {
    return this.compare(other) === 0;
  }

  public isGreaterThan(other: SemVer): boolean {
    return this.compare(other) > 0;
  }

  public isGreaterThanOrEqual(other: SemVer): boolean {
    return this.compare(other) >= 0;
  }

  public isLessThan(other: SemVer): boolean {
    return this.compare(other) < 0;
  }

  public isLessThanOrEqual(other: SemVer): boolean {
    return this.compare(other) <= 0;
  }

  public static satisfies(
    current: string,
    requirement: RangeInput,
    opts?: SemVerSatisfiesOptions,
  ): boolean {
    return SemVerRange.satisfies(current, requirement, opts);
  }
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const xn = Number(x);
      const yn = Number(y);
      if (xn !== yn) return xn < yn ? -1 : 1;
      continue;
    }
    if (xNum && !yNum) return -1;
    if (!xNum && yNum) return 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

type ComparatorOp = '>' | '>=' | '<' | '<=' | '==';

interface Comparator {
  op: ComparatorOp;
  version: SemVer;
}

export class SemVerRange {
  private readonly groups: Comparator[][];
  private readonly includePrerelease: boolean;

  private constructor(groups: Comparator[][], includePrerelease: boolean) {
    if (groups.length === 0) {
      throw new Error('SemVerRange must have at least one group');
    }
    this.groups = groups;
    this.includePrerelease = includePrerelease;
  }

  public static any(opts?: SemVerSatisfiesOptions): SemVerRange {
    return new SemVerRange([[]], opts?.includePrerelease === true);
  }

  public static parse(requirement: RangeInput, opts?: SemVerSatisfiesOptions): SemVerRange {
    const includePrerelease = opts?.includePrerelease === true;
    if (Array.isArray(requirement)) {
      if (requirement.length === 0) {
        return SemVerRange.any(opts);
      }
      const joined = requirement.map((s) => String(s).trim()).filter(Boolean);
      if (joined.length === 0) return SemVerRange.any(opts);
      return SemVerRange.parse(joined.join(' '), opts);
    }

    const raw = String(requirement ?? '').trim();
    if (!raw || raw === '*' || raw.toLowerCase() === 'any' || raw === 'x' || raw === 'X') {
      return SemVerRange.any(opts);
    }

    const orGroups = raw
      .split('||')
      .map((g) => g.trim())
      .filter(Boolean);
    if (orGroups.length === 0) {
      throw new Error(`Invalid requirement expression: "${requirement}"`);
    }

    const parsedGroups: Comparator[][] = orGroups.map((groupStr) =>
      expandGroupToComparators(groupStr),
    );
    return new SemVerRange(parsedGroups, includePrerelease);
  }

  public satisfies(version: SemVer): boolean {
    return this.groups.some((group) => this.satisfiesGroup(version, group));
  }

  private satisfiesGroup(version: SemVer, group: Comparator[]): boolean {
    if (group.length === 0) return true;
    if (!this.includePrerelease && version.hasPrerelease) {
      const rangeMentionsPrerelease = group.some((c) => c.version.hasPrerelease);
      if (!rangeMentionsPrerelease) return false;
    }
    return group.every((c) => compareWithOp(version, c.op, c.version));
  }

  public static satisfies(
    current: string,
    requirement: RangeInput,
    opts?: SemVerSatisfiesOptions,
  ): boolean {
    const v = SemVer.parse(current);
    const range = SemVerRange.parse(requirement, opts);
    return range.satisfies(v);
  }
}

function compareWithOp(v: SemVer, op: ComparatorOp, r: SemVer): boolean {
  const cmp = v.compare(r);
  switch (op) {
    case '>':
      return cmp > 0;
    case '>=':
      return cmp >= 0;
    case '<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
    case '==':
      return cmp === 0;
    default:
      throw new Error(`Unhandled operator: ${op}`);
  }
}

function expandGroupToComparators(groupStr: string): Comparator[] {
  const work = groupStr.trim();
  const hyphen = work.match(
    /^v?(\d+(?:\.\d+)?(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)\s+-\s+v?(\d+(?:\.\d+)?(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)$/i,
  );
  if (hyphen) {
    const lo = SemVer.parse(hyphen[1]);
    const hi = SemVer.parse(hyphen[2]);
    return [
      { op: '>=', version: lo },
      { op: '<=', version: hi },
    ];
  }

  const parts = work
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Comparator[] = [];
  for (const part of parts) {
    out.push(...expandToken(part));
  }
  return out;
}

function expandToken(token: string): Comparator[] {
  const t = token.trim();
  if (!t) return [];

  if (t === '*' || t === 'x' || t === 'X' || t.toLowerCase() === 'any') {
    return [];
  }

  const opMatch = t.match(/^([><]=?|=|==|\^|~)?v?(.+)$/i);
  if (!opMatch) {
    throw new Error(`Invalid constraint token: "${token}"`);
  }
  let opRaw = opMatch[1] ?? '==';
  const rest = opMatch[2];
  if (opRaw === '=>') opRaw = '>=';
  if (opRaw === '=<') opRaw = '<=';
  if (opRaw === '=') opRaw = '==';

  if (/[xX*]/.test(rest) && opRaw === '==') {
    return expandXRange(rest);
  }

  if (opRaw === '^') {
    const v = parsePartial(rest);
    return caretComparators(v);
  }
  if (opRaw === '~') {
    const v = parsePartial(rest);
    return tildeComparators(v);
  }

  if (opRaw !== '==' && opRaw !== '>' && opRaw !== '>=' && opRaw !== '<' && opRaw !== '<=') {
    throw new Error(`Unsupported operator "${opRaw}" in token "${token}"`);
  }

  const version = SemVer.parse(completeVersionString(rest));
  return [{ op: opRaw as ComparatorOp, version }];
}

interface PartialVer {
  major: number;
  minor: number | null;
  patch: number | null;
  prerelease: string[];
}

function parsePartial(input: string): PartialVer {
  const normalized = input.trim().replace(/^v/i, '');
  const match = normalized.match(
    /^(\d+|x|X|\*)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:-([0-9A-Za-z.-]+))?$/,
  );
  if (!match) {
    throw new Error(`Invalid version in range: "${input}"`);
  }
  const major = isX(match[1]) ? null : Number(match[1]);
  if (major === null) {
    throw new Error(`Invalid version in range: "${input}"`);
  }
  const minor = match[2] === undefined || isX(match[2]) ? null : Number(match[2]);
  const patch = match[3] === undefined || isX(match[3]) ? null : Number(match[3]);
  const prerelease =
    match[4] !== undefined && match[4].length > 0 ? match[4].split('.').filter(Boolean) : [];
  return { major, minor, patch, prerelease };
}

function isX(s: string | undefined): boolean {
  if (s === undefined) return false;
  return s === 'x' || s === 'X' || s === '*';
}

function completeVersionString(rest: string): string {
  const normalized = rest.trim().replace(/^v/i, '');
  const parts = normalized.split('-');
  const core = parts[0] ?? '0';
  const pre = parts.length > 1 ? parts.slice(1).join('-') : '';
  const segs = core.split('.');
  while (segs.length < 3) segs.push('0');
  const base = segs.slice(0, 3).join('.');
  return pre ? `${base}-${pre}` : base;
}

function expandXRange(rest: string): Comparator[] {
  const normalized = rest.trim().replace(/^v/i, '');
  const segs = normalized.split('.');
  const a = segs[0] ?? '*';
  const b = segs[1];
  const c = segs[2];

  if (isX(a) || a === '*') {
    return [];
  }
  const major = Number(a);
  if (b === undefined || isX(b)) {
    return [
      { op: '>=', version: new SemVer(major, 0, 0) },
      { op: '<', version: new SemVer(major + 1, 0, 0) },
    ];
  }
  const minor = Number(b);
  if (c === undefined || isX(c)) {
    return [
      { op: '>=', version: new SemVer(major, minor, 0) },
      { op: '<', version: new SemVer(major, minor + 1, 0) },
    ];
  }
  const patch = Number(c);
  return [{ op: '==', version: new SemVer(major, minor, patch) }];
}

function caretComparators(v: PartialVer): Comparator[] {
  const major = v.major;
  const minor = v.minor ?? 0;
  const patch = v.patch ?? 0;
  const lower = new SemVer(major, minor, patch, v.prerelease);
  if (major > 0) {
    return [
      { op: '>=', version: lower },
      { op: '<', version: new SemVer(major + 1, 0, 0) },
    ];
  }
  if (minor > 0) {
    return [
      { op: '>=', version: lower },
      { op: '<', version: new SemVer(0, minor + 1, 0) },
    ];
  }
  return [
    { op: '>=', version: lower },
    { op: '<', version: new SemVer(0, 0, patch + 1) },
  ];
}

function tildeComparators(v: PartialVer): Comparator[] {
  const major = v.major;
  if (v.minor === null) {
    return [
      { op: '>=', version: new SemVer(major, 0, 0, v.prerelease) },
      { op: '<', version: new SemVer(major + 1, 0, 0) },
    ];
  }
  const minor = v.minor;
  const patch = v.patch ?? 0;
  return [
    { op: '>=', version: new SemVer(major, minor, patch, v.prerelease) },
    { op: '<', version: new SemVer(major, minor + 1, 0) },
  ];
}

const cliCmd = typeof process !== 'undefined' ? process.argv[2] : undefined;
if (cliCmd === 'satisfies' && process.argv.length >= 5) {
  const version = process.argv[3] ?? '';
  const range = process.argv[4] ?? '*';
  const includePrerelease = process.argv.includes('--include-prerelease');
  try {
    const ok = SemVerRange.satisfies(version, range, { includePrerelease });
    process.stdout.write(ok ? 'yes\n' : 'no\n');
    process.exit(ok ? 0 : 1);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(2);
  }
}
