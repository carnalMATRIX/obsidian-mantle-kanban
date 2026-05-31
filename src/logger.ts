export type LogLevel = "debug" | "info" | "warn" | "error";

export class Logger {
  private prefix: string;
  private isDebug: boolean;

  constructor(name: string, isDebug: boolean = false) {
    this.prefix = `[${name}]`;
    this.isDebug = isDebug;
  }

  public debug(message: string, ...args: any[]) {
    if (this.isDebug) {
      console.log(`${this.prefix} [DEBUG] ${message}`, ...args);
    }
  }

  public info(message: string, ...args: any[]) {
    console.log(`${this.prefix} [INFO] ${message}`, ...args);
  }

  public warn(message: string, ...args: any[]) {
    console.warn(`${this.prefix} [WARN] ${message}`, ...args);
  }

  public error(message: string, error?: any, ...args: any[]) {
    console.error(`${this.prefix} [ERROR] ${message}`, error || "", ...args);
  }
}
