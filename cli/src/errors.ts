export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

/** Network unavailable or server 5xx: callers may fall back to the outbox / cache. */
export class OfflineError extends Error {
  constructor(message = 'network unavailable') {
    super(message);
    this.name = 'OfflineError';
  }
}