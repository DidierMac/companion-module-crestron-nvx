import { execFileSync } from 'node:child_process'

export interface LogMark {
  ts: string
}
type Exec = (container: string, sinceTs: string) => string

function defaultExec(container: string, sinceTs: string): string {
  return execFileSync('docker', ['logs', '--since', sinceTs, container], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** Reads Companion container logs, correlated to an action via a time mark + label + prefix. */
export class CompanionLogs {
  constructor(
    private container: string,
    private exec: Exec = defaultExec,
  ) {}

  /** Stamp the current time; pass to since()/detect() after an action.
   *  The `Z` suffix is mandatory for `docker logs --since` (Wave-0 finding). */
  mark(): LogMark {
    return { ts: new Date().toISOString() }
  }

  /** New log lines since `mark`, for `label`, optionally containing `prefix`. */
  since(mark: LogMark, label: string, prefix?: string): string[] {
    const out = this.exec(this.container, mark.ts)
    return out.split('\n').filter((l) => l.includes(label) && (!prefix || l.includes(prefix)))
  }

  /** True if any line since `mark` for `label` matches `re`. */
  detect(mark: LogMark, label: string, re: RegExp): boolean {
    return this.since(mark, label).some((l) => re.test(l))
  }
}
