import type { LogLevel } from '@companion-module/base'

type LogFn = (level: LogLevel, message: string) => void

interface LogConfig {
  verbose: boolean
}

export class ModuleLogger {
  private readonly config: LogConfig

  constructor(
    private readonly logFn: LogFn,
    private readonly prefix: string,
    config: boolean | LogConfig,
  ) {
    this.config = typeof config === 'boolean' ? { verbose: config } : config
  }

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

  child(childPrefix: string): ModuleLogger {
    return new ModuleLogger(this.logFn, childPrefix, this.config)
  }

  private format(message: string): string {
    return this.prefix ? `${this.prefix} ${message}` : message
  }
}
