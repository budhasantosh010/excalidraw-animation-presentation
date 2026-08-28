import {
  applyRevisionOperations,
  buildAnimationDocument,
  summarizeAnimationDocument,
  validateAnimationDocument,
  type ExcalidrawDocument,
} from './animation-tools.ts'

export type R2BucketLike = {
  get(key: string): Promise<{
    etag: string
    text(): Promise<string>
  } | null>
  put(
    key: string,
    value: string,
    options?: {
      customMetadata?: Record<string, string>
      onlyIf?: {
        etagMatches?: string
        etagDoesNotMatch?: string
      }
    },
  ): Promise<{ etag: string } | null>
  list(options?: { cursor?: string; prefix?: string; include?: ['customMetadata'] }): Promise<{
    objects: Array<{ key: string; customMetadata?: Record<string, string> }>
    truncated: boolean
    cursor?: string
  }>
}

const validFilename = (filename: string) =>
  /^[A-Za-z0-9._-]+\.excalidraw$/i.test(filename)

const assertFilename = (filename: string) => {
  if (!validFilename(filename)) throw new Error('Invalid output filename.')
  return filename
}

const generatedFilename = (projectName: string) => {
  const base =
    projectName
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'animation'
  return `${base}-${crypto.randomUUID().slice(0, 8)}.excalidraw`
}

export class R2AnimationStore {
  constructor(private readonly bucket: R2BucketLike) {}

  async create(
    storyboard: unknown,
    requestedFilename?: string,
  ) {
    const document = buildAnimationDocument(storyboard)
    const validation = validateAnimationDocument(document)
    if (!validation.valid) throw new Error(validation.errors.join(' '))
    const projectName = String(
      (storyboard as { projectName?: unknown }).projectName ?? 'animation',
    )
    const filename = assertFilename(
      requestedFilename ?? generatedFilename(projectName),
    )
    const stored = await this.bucket.put(
      filename,
      `${JSON.stringify(document)}\n`,
      { onlyIf: { etagDoesNotMatch: '*' } },
    )
    if (!stored) {
      throw new Error(`Animation already exists: ${filename}`)
    }
    return {
      status: 'created',
      ...summarizeAnimationDocument(filename, document),
      elementCount: validation.elementCount,
      validationStatus: 'valid',
    }
  }

  async read(filename: string): Promise<ExcalidrawDocument> {
    const object = await this.readObject(filename)
    return JSON.parse(await object.text()) as ExcalidrawDocument
  }

  private async readObject(filename: string) {
    const object = await this.bucket.get(assertFilename(filename))
    if (!object) throw new Error(`Animation not found: ${filename}`)
    return object
  }

  async revise(
    filename: string,
    operations: Array<Record<string, unknown>>,
  ) {
    const source = await this.readObject(filename)
    const document = applyRevisionOperations(
      JSON.parse(await source.text()) as ExcalidrawDocument,
      operations,
    )
    const validation = validateAnimationDocument(document)
    if (!validation.valid) throw new Error(validation.errors.join(' '))
    const stored = await this.bucket.put(
      assertFilename(filename),
      `${JSON.stringify(document)}\n`,
      { onlyIf: { etagMatches: source.etag } },
    )
    if (!stored) {
      throw new Error(
        `Animation changed while revising; reload and retry: ${filename}`,
      )
    }
    return { status: 'revised', filename, operationsApplied: operations.length }
  }

  async validate(filename: string) {
    return validateAnimationDocument(await this.read(filename))
  }

  async list() {
    const filenames: string[] = []
    let cursor: string | undefined
    do {
      const result = await this.bucket.list(cursor ? { cursor } : undefined)
      filenames.push(
        ...result.objects
          .map((object) => object.key)
          .filter(validFilename),
      )
      cursor = result.truncated ? result.cursor : undefined
      if (result.truncated && !cursor) {
        throw new Error('R2 pagination cursor is missing.')
      }
    } while (cursor)
    return filenames.sort()
  }
}
