import { SemVer, SemVerRange, type RangeInput, type SemVerSatisfiesOptions } from "./semver.js";

export class NodeVersion {
  private static _current?: SemVer;

  public static current(): SemVer {
    if (!this._current) {
      this._current = SemVer.parse(process.versions.node);
    }
    return this._current;
  }

  public static satisfies(requirement: RangeInput, opts?: SemVerSatisfiesOptions): boolean {
    const current = this.current();
    const range = SemVerRange.parse(requirement, opts);
    return range.satisfies(current);
  }

  public static isAtLeast(minVersion: string): boolean {
    return this.satisfies(`>=${minVersion}`);
  }

  public static assert(requirement: RangeInput, opts?: SemVerSatisfiesOptions): void {
    if (!this.satisfies(requirement, opts)) {
      const current = this.current().toString();
      throw new Error(
        `Unsupported Node.js version: ${current}. Requirement: ${JSON.stringify(requirement)}.`,
      );
    }
  }
}
