import { SemVer, SemVerRange } from "./semver.js";

export class NodeVersion {
  private static _current?: SemVer;

  public static current(): SemVer {
    if (!this._current) {
      this._current = SemVer.parse(process.versions.node);
    }
    return this._current;
  }

  public static satisfies(requirement: string): boolean {
    const current = this.current();
    const range = SemVerRange.parse(requirement);
    return range.satisfies(current);
  }

  public static isAtLeast(minVersion: string): boolean {
    return this.satisfies(`>=${minVersion}`);
  }

  public static assert(requirement: string): void {
    if (!this.satisfies(requirement)) {
      const current = this.current().toString();
      throw new Error(
        `Unsupported Node.js version: ${current}. Requirement: "${requirement}".`,
      );
    }
  }
}
