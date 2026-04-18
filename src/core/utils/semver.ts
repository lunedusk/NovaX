export class SemVer {
  public readonly major: number;
  public readonly minor: number;
  public readonly patch: number;

  public constructor(major: number, minor: number = 0, patch: number = 0) {
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
  }

  public static parse(input: string): SemVer {
    if (!input) {
      throw new Error("Version string is empty");
    }

    const normalized = input.trim().replace(/^v/i, "");

    const match = normalized.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    if (!match) {
      throw new Error(`Invalid semver string: "${input}"`);
    }

    const major = Number(match[1]);
    const minor = match[2] !== undefined ? Number(match[2]) : 0;
    const patch = match[3] !== undefined ? Number(match[3]) : 0;

    return new SemVer(major, minor, patch);
  }

  public toString(): string {
    return `${this.major}.${this.minor}.${this.patch}`;
  }

  public compare(other: SemVer): number {
    if (this.major !== other.major) {
      return this.major < other.major ? -1 : 1;
    }
    if (this.minor !== other.minor) {
      return this.minor < other.minor ? -1 : 1;
    }
    if (this.patch !== other.patch) {
      return this.patch < other.patch ? -1 : 1;
    }
    return 0;
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

  public static satisfies(current: string, requirement: string): boolean {
    return SemVerRange.satisfies(current, requirement);
  }
}

type Operator = ">" | ">=" | "<" | "<=" | "==" | "^" | "~";

interface SemVerConstraint {
  op: Operator;
  version: SemVer;
}
export class SemVerRange {
  private readonly groups: SemVerConstraint[][];

  private constructor(groups: SemVerConstraint[][]) {
    if (groups.length === 0) {
      throw new Error("SemVerRange must have at least one group");
    }
    this.groups = groups;
  }

  public static any(): SemVerRange {
    return new SemVerRange([[]]);
  }

  public static parse(requirement: string): SemVerRange {
    if (!requirement || requirement.trim() === "*" || requirement.trim().toLowerCase() === "any") {
      return SemVerRange.any();
    }

    const orGroups = requirement
      .split("||")
      .map(g => g.trim())
      .filter(Boolean);

    if (orGroups.length === 0) {
      throw new Error(`Invalid requirement expression: "${requirement}"`);
    }

    const parsedGroups: SemVerConstraint[][] = orGroups.map(groupStr => {
      const parts = groupStr
        .split(/\s+/)
        .map(s => s.trim())
        .filter(Boolean);

      if (parts.length === 0) return [];
      return parts.map(part => SemVerRange.parseConstraint(part));
    });

    return new SemVerRange(parsedGroups);
  }

  private static parseConstraint(token: string): SemVerConstraint {
    const regex = /^([><=^~]+)?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
    const match = token.match(regex);

    if (!match) {
      throw new Error(`Invalid constraint token: "${token}"`);
    }

    let opRaw = match[1] ?? "==";
    const major = Number(match[2]);
    const minor = match[3] !== undefined ? Number(match[3]) : 0;
    const patch = match[4] !== undefined ? Number(match[4]) : 0;

    if (opRaw === "=>") opRaw = ">=";
    if (opRaw === "=<") opRaw = "<=";
    if (opRaw === "=") opRaw = "==";

    const allowedOps: Operator[] = [">", ">=", "<", "<=", "==", "^", "~"];
    if (!allowedOps.includes(opRaw as Operator)) {
      throw new Error(`Unsupported operator "${opRaw}" in token "${token}"`);
    }

    const version = new SemVer(major, minor, patch);
    return { op: opRaw as Operator, version };
  }

  public satisfies(version: SemVer): boolean {
    return this.groups.some(group => this.satisfiesGroup(version, group));
  }

  private satisfiesGroup(version: SemVer, group: SemVerConstraint[]): boolean {
    return group.every(constraint => this.satisfiesConstraint(version, constraint));
  }

  private satisfiesConstraint(v: SemVer, { op, version: r }: SemVerConstraint): boolean {
    switch (op) {
      case ">":
        return v.isGreaterThan(r);
      case ">=":
        return v.isGreaterThanOrEqual(r);
      case "<":
        return v.isLessThan(r);
      case "<=":
        return v.isLessThanOrEqual(r);
      case "==":
        return v.isEqual(r);
      case "^":
        if (v.major !== r.major) return false;
        return v.isGreaterThanOrEqual(r);
      case "~":
        if (v.major !== r.major || v.minor !== r.minor) return false;
        return v.isGreaterThanOrEqual(r);
      default:
        throw new Error(`Unhandled operator: ${op}`);
    }
  }

  public static satisfies(current: string, requirement: string): boolean {
    const v = SemVer.parse(current);
    const range = SemVerRange.parse(requirement);
    return range.satisfies(v);
  }
}
