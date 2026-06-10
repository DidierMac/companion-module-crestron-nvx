import type { LogLevel } from '@companion-module/base'

type LogFn = (level: LogLevel, message: string) => void

interface LogConfig {
  verbose: boolean
}

export class ModuleLogger {
  private config: LogConfig

  constructor(
    private readonly logFn: LogFn,
    private readonly prefix: string,
    config: boolean | LogConfig,
  ) {
    this.config = typeof config === 'boolean' ? { verbose: config } : config
  }

  /**
   * Update the verbose flag. Because child loggers share the same config
   * object, this call propagates to all loggers created via child().
   * Only call this on the root logger (from main.ts configUpdated).
   */
  setVerbose(verbose: boolean): void {
    this.config.verbose = verbose
  }

  debug(message: string): void {
    if (this.config.verbose) {
      this.logFn('info', this.format(message))
    }
  }

  info(message: string): void {
    this.logFn('info', this.format(message))
  }

  warn(message: string): void {
    this.logFn('warn', this.format(message))
  }

  error(message: string): void {
    this.logFn('error', this.format(message))
  }

  /**
   * Create a child logger with the given component prefix (e.g. '[AUTH]').
   * The child shares the same config object — setVerbose() on the root
   * logger propagates automatically to all children.
   */
  child(childPrefix: string): ModuleLogger {
    return new ModuleLogger(this.logFn, childPrefix, this.config)
  }

  private format(message: string): string {
    return this.prefix ? `${this.prefix} ${message}` : message
  }
}
