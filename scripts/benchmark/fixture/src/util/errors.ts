export class ValidationError extends Error {
  field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class NotFoundError extends Error {
  constructor(label: string, id: number) {
    super(`${label} ${id} not found`);
    this.name = 'NotFoundError';
  }
}
