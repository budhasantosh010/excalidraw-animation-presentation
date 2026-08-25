export class PersistenceNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PersistenceNotFoundError'
  }
}

export class PersistenceConflictError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PersistenceConflictError'
  }
}

export class PersistenceNameConflictError extends PersistenceConflictError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PersistenceNameConflictError'
  }
}

export class PersistenceAssetReferenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PersistenceAssetReferenceError'
  }
}

export const isSqliteUniqueConstraintError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string' &&
  error.code.startsWith('SQLITE_CONSTRAINT_UNIQUE')
