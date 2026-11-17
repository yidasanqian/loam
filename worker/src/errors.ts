/** An error that maps to a JSON error response. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
  }
}