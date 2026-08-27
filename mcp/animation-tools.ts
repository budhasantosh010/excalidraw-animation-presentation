import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import {
  getElementAnimation,
  MAX_ANIMATION_STEP,
} from '../src/animation.ts'
import {
  updateAnimationDefinition,
  updateSceneDefinition,
} from '../src/timeline.ts'

export type AnimationEffect = 'auto' | 'appear' | 'fade' | 'pop' | 'draw'

export type StoryboardElement = {
  id: string
  type: 'rectangle' | 'ellipse' | 'diamond' | 'text' | 'arrow' | 'line'
  x: number
  y: number
  width: number
  height: number
  text?: string
  startElementId?: string
  endElementId?: string
  style?: Record<string, unknown>
  animation: { step: number; effect: AnimationEffect }
}

export type Storyboard = {
  projectName: string
  scenes: Array<{
    sceneId: string
    title: string
    elements: StoryboardElement[]
  }>
}

type ExcalidrawElement = Record<string, any>
export type ExcalidrawDocument = {
  type: 'excalidraw'
  version: 2
  source: 'local'
  elements: ExcalidrawElement[]
  appState: Record<string, unknown>
  files: Record<string, never>
}

const effects = new Set<AnimationEffect>([
  'auto',
  'appear',
  'fade',
  'pop',
  'draw',
])
const supportedTypes = new Set([
  'rectangle',
  'ellipse',
  'diamond',
  'text',
  'arrow',
  'line',
])

const slug = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'animation'

const seedFor = (id: string) =>
  createHash('sha256').update(id).digest().readUInt32BE(0) & 0x7fffffff

const animationData = (
  sceneId: string,
  animation: StoryboardElement['animation'],
) => ({
  sanverseAnimation: {
    version: 1,
    sceneId,
    step: animation.step,
    effect: animation.effect,
  },
})

const commonElement = (
  id: string,
  type: string,
  sceneId: string,
  frameId: string,
  input: Pick<StoryboardElement, 'x' | 'y' | 'width' | 'height'>,
) => ({
  id,
  type,
  x: input.x,
  y: input.y,
  width: input.width,
  height: input.height,
  angle: 0,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId,
  index: `a${sceneId}_${id}`,
  roundness: type === 'rectangle' ? { type: 3 } : null,
  seed: seedFor(id),
  version: 1,
  versionNonce: seedFor(`${id}:nonce`),
  isDeleted: false,
  boundElements: null,
  updated: Date.now(),
  link: null,
  locked: false,
})

export const validateStoryboard = (value: unknown): Storyboard => {
  if (!value || typeof value !== 'object') throw new Error('Storyboard is required.')
  const storyboard = value as Storyboard
  if (!storyboard.projectName?.trim()) throw new Error('projectName is required.')
  if (!Array.isArray(storyboard.scenes) || storyboard.scenes.length === 0) {
    throw new Error('At least one scene is required.')
  }
  if (storyboard.scenes.length > 20) throw new Error('Too many scenes.')

  const ids = new Set<string>()
  for (const scene of storyboard.scenes) {
    if (!scene.sceneId?.trim() || !Array.isArray(scene.elements)) {
      throw new Error('Each scene needs sceneId and elements.')
    }
    for (const element of scene.elements) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(element.id) || ids.has(element.id)) {
        throw new Error(`Invalid or duplicate element id: ${element.id}`)
      }
      ids.add(element.id)
      if (!supportedTypes.has(element.type)) {
        throw new Error(`Unsupported element type: ${element.type}`)
      }
      for (const number of [element.x, element.y, element.width, element.height]) {
        if (!Number.isFinite(number)) throw new Error(`Invalid geometry: ${element.id}`)
      }
      if (element.width < 0 || element.height < 0) {
        throw new Error(`Invalid geometry: ${element.id}`)
      }
      if (
        !Number.isSafeInteger(element.animation?.step) ||
        element.animation.step < 1 ||
        element.animation.step > MAX_ANIMATION_STEP ||
        !effects.has(element.animation.effect)
      ) {
        throw new Error(`Invalid animation metadata: ${element.id}`)
      }
    }
  }
  if (!storyboard.scenes.some((scene) => scene.elements.length > 0)) {
    throw new Error('At least one drawable element is required.')
  }
  return storyboard
}

export const buildAnimationDocument = (input: unknown): ExcalidrawDocument => {
  const storyboard = validateStoryboard(input)
  const elements: ExcalidrawElement[] = []
  const byId = new Map<string, ExcalidrawElement>()

  storyboard.scenes.forEach((scene, sceneIndex) => {
    const frameId = `frame_${scene.sceneId}`
    const frameX = sceneIndex * 1800
    elements.push({
      ...commonElement(
        frameId,
        'frame',
        scene.sceneId,
        null as unknown as string,
        { x: frameX, y: 0, width: 1600, height: 900 },
      ),
      frameId: null,
      name: scene.title || `Scene ${sceneIndex + 1}`,
      backgroundColor: '#ffffff',
    })

    for (const inputElement of scene.elements) {
      const element: ExcalidrawElement = {
        ...commonElement(
          inputElement.id,
          inputElement.type,
          scene.sceneId,
          frameId,
          inputElement,
        ),
        ...inputElement.style,
        customData: animationData(scene.sceneId, inputElement.animation),
      }
      if (inputElement.type === 'text') {
        Object.assign(element, {
          text: inputElement.text ?? '',
          rawText: inputElement.text ?? '',
          originalText: inputElement.text ?? '',
          fontSize: 32,
          fontFamily: 5,
          textAlign: 'left',
          verticalAlign: 'top',
          containerId: null,
          autoResize: true,
          lineHeight: 1.25,
        })
      }
      if (inputElement.type === 'arrow' || inputElement.type === 'line') {
        Object.assign(element, {
          points: [
            [0, 0],
            [inputElement.width, inputElement.height],
          ],
          startBinding: inputElement.startElementId
            ? {
                elementId: inputElement.startElementId,
                focus: 0,
                gap: 8,
                fixedPoint: null,
              }
            : null,
          endBinding: inputElement.endElementId
            ? {
                elementId: inputElement.endElementId,
                focus: 0,
                gap: 8,
                fixedPoint: null,
              }
            : null,
          startArrowhead: null,
          endArrowhead: inputElement.type === 'arrow' ? 'arrow' : null,
          lastCommittedPoint: null,
        })
      }
      elements.push(element)
      byId.set(element.id, element)

      if (inputElement.type !== 'text' && inputElement.text) {
        const labelId = `${inputElement.id}__label`
        const label = {
          ...commonElement(
            labelId,
            'text',
            scene.sceneId,
            frameId,
            {
              x: inputElement.x + 12,
              y: inputElement.y + inputElement.height / 2 - 20,
              width: Math.max(20, inputElement.width - 24),
              height: 40,
            },
          ),
          text: inputElement.text,
          rawText: inputElement.text,
          originalText: inputElement.text,
          fontSize: 28,
          fontFamily: 5,
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: inputElement.id,
          autoResize: true,
          lineHeight: 1.25,
          customData: animationData(scene.sceneId, inputElement.animation),
        }
        element.boundElements = [{ id: labelId, type: 'text' }]
        elements.push(label)
        byId.set(labelId, label)
      }
    }
  })

  for (const element of elements) {
    for (const binding of [element.startBinding, element.endBinding]) {
      if (!binding) continue
      const target = byId.get(binding.elementId)
      if (!target) throw new Error(`Missing connection target: ${binding.elementId}`)
      target.boundElements = [
        ...(target.boundElements ?? []),
        { id: element.id, type: 'arrow' },
      ]
    }
  }

  return {
    type: 'excalidraw',
    version: 2,
    source: 'local',
    elements,
    appState: { viewBackgroundColor: '#ffffff', gridSize: null },
    files: {},
  }
}

export const validateAnimationDocument = (document: unknown) => {
  const errors: string[] = []
  if (!document || typeof document !== 'object') return { valid: false, errors: ['Invalid document.'] }
  const candidate = document as Partial<ExcalidrawDocument>
  if (candidate.type !== 'excalidraw' || !Array.isArray(candidate.elements)) {
    return { valid: false, errors: ['Invalid Excalidraw document shape.'] }
  }
  const ids = new Set<string>()
  for (const element of candidate.elements) {
    if (!element.id || ids.has(element.id)) errors.push(`Duplicate or missing id: ${element.id}`)
    ids.add(element.id)
    if (element.isDeleted) continue
    if (element.type === 'frame') {
      if (element.width !== 1600 || element.height !== 900) {
        errors.push(`Frame ${element.id} must be 1600x900.`)
      }
      continue
    }
    if (
      element.customData?.sanverseAnimation !== undefined &&
      !getElementAnimation(element as never)
    ) {
      errors.push(`Invalid animation metadata: ${element.id}`)
    }
  }
  for (const element of candidate.elements) {
    for (const binding of [element.startBinding, element.endBinding]) {
      if (binding?.elementId && !ids.has(binding.elementId)) {
        errors.push(`Missing connection target: ${binding.elementId}`)
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    sceneCount: candidate.elements.filter((element) => element.type === 'frame').length,
    elementCount: candidate.elements.filter((element) => element.type !== 'frame').length,
  }
}

export const summarizeAnimationDocument = (
  filename: string,
  document: ExcalidrawDocument,
  revision = 1,
) => {
  const drawableElements = document.elements.filter(
    (element) => !element.isDeleted && element.type !== 'frame',
  )
  const animations = drawableElements.flatMap((element) => {
    const animation = getElementAnimation(element as never)
    return animation ? [animation] : []
  })
  const effectCounts: Record<AnimationEffect, number> = {
    auto: 0,
    appear: 0,
    fade: 0,
    pop: 0,
    draw: 0,
  }
  for (const animation of animations) {
    effectCounts[animation.effect] += 1
  }

  return {
    filename,
    revision,
    sceneCount: document.elements.filter(
      (element) => !element.isDeleted && element.type === 'frame',
    ).length,
    drawableElementCount: drawableElements.length,
    totalSerializedElementCount: document.elements.length,
    animatedElementCount: animations.length,
    stepCount: animations.reduce(
      (maximum, animation) => Math.max(maximum, animation.step),
      0,
    ),
    effectCounts,
  }
}

const safeOutputPath = (outputDir: string, filename: string) => {
  if (
    !/^[A-Za-z0-9._-]+\.excalidraw$/i.test(filename) ||
    basename(filename) !== filename
  ) {
    throw new Error('Invalid output filename.')
  }
  const root = resolve(outputDir)
  const target = resolve(root, filename)
  if (dirname(target) !== root) throw new Error('Invalid output filename.')
  return target
}

const atomicJsonWrite = async (target: string, document: unknown) => {
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(document)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })
  await rename(temporary, target)
}

export const createAnimationFile = async (
  outputDir: string,
  storyboard: unknown,
  requestedFilename?: string,
) => {
  const document = buildAnimationDocument(storyboard)
  const validation = validateAnimationDocument(document)
  if (!validation.valid) throw new Error(validation.errors.join(' '))
  await mkdir(outputDir, { recursive: true })
  const filename =
    requestedFilename ??
    `${slug((storyboard as Storyboard).projectName)}-${randomUUID().slice(0, 8)}.excalidraw`
  const target = safeOutputPath(outputDir, filename)
  await atomicJsonWrite(target, document)
  return {
    status: 'created',
    ...summarizeAnimationDocument(filename, document),
    elementCount: validation.elementCount,
    validationStatus: 'valid',
  }
}

export const readAnimationFile = async (outputDir: string, filename: string) => {
  const target = safeOutputPath(outputDir, filename)
  return JSON.parse(await readFile(target, 'utf8')) as ExcalidrawDocument
}

const editableFields = new Set([
  'x', 'y', 'width', 'height', 'angle', 'strokeColor', 'backgroundColor',
  'fillStyle', 'strokeWidth', 'strokeStyle', 'roughness', 'opacity', 'locked',
  'text', 'fontSize', 'fontFamily', 'textAlign', 'verticalAlign',
])

const requireElement = (
  byId: Map<string, ExcalidrawElement>,
  operation: Record<string, unknown>,
) => {
  const id = String(operation.elementId ?? '')
  const element = byId.get(id)
  if (!element) throw new Error(`Element not found: ${id}`)
  return element
}

const bumpElement = (element: ExcalidrawElement) => {
  element.version = Number(element.version ?? 0) + 1
  element.versionNonce = seedFor(`${element.id}:${element.version}:${Date.now()}`)
  element.updated = Date.now()
}

const validateEditablePatch = (patch: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(patch)) {
    if (!editableFields.has(key)) throw new Error(`Unsupported element field: ${key}`)
    if (['x', 'y', 'width', 'height', 'angle', 'strokeWidth', 'roughness', 'opacity', 'fontSize', 'fontFamily'].includes(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Invalid ${key}.`)
      }
    }
    if ((key === 'width' || key === 'height') && Number(value) < 0) {
      throw new Error(`Invalid ${key}.`)
    }
    if (key === 'opacity' && (Number(value) < 0 || Number(value) > 100)) {
      throw new Error('Invalid opacity; expected 0 to 100.')
    }
    if (['strokeColor', 'backgroundColor', 'fillStyle', 'strokeStyle', 'textAlign', 'verticalAlign', 'text'].includes(key) && typeof value !== 'string') {
      throw new Error(`Invalid ${key}.`)
    }
    if (key === 'locked' && typeof value !== 'boolean') throw new Error('Invalid locked.')
  }
}

export const applyRevisionOperations = (
  source: ExcalidrawDocument,
  operations: Array<Record<string, unknown>>,
): ExcalidrawDocument => {
  const document = structuredClone(source)
  let byId = new Map(document.elements.map((element) => [element.id, element]))
  for (const operation of operations) {
    const type = String(operation.type ?? '')
    if (type === 'add_element') {
      const input = structuredClone(operation.element)
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('add_element requires an element object.')
      }
      const element = input as ExcalidrawElement
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(element.id ?? '')) || byId.has(element.id)) {
        throw new Error(`Invalid or duplicate element id: ${element.id}`)
      }
      document.elements.push(element)
      byId.set(element.id, element)
      continue
    }

    const element = requireElement(byId, operation)
    if (type === 'change_text' && element.type === 'text') {
      element.text = String(operation.text ?? '')
      element.rawText = element.text
      element.originalText = element.text
    } else if (type === 'set_animation_step') {
      const step = Number(operation.step)
      if (!Number.isSafeInteger(step) || step < 1 || step > MAX_ANIMATION_STEP) {
        throw new Error('Invalid animation step.')
      }
      element.customData.sanverseAnimation.step = step
    } else if (type === 'set_animation_effect') {
      const effect = String(operation.effect) as AnimationEffect
      if (!effects.has(effect)) throw new Error('Invalid animation effect.')
      element.customData.sanverseAnimation.effect = effect
    } else if (type === 'set_animation_timing') {
      document.elements = updateAnimationDefinition(
        document.elements as never,
        [element.id],
        {
          durationMs: Number(operation.durationMs),
          delayMs: Number(operation.delayMs ?? 0),
          easing: operation.easing as never,
          phase: operation.phase as never,
          transform: operation.transform as never,
        },
      ) as unknown as ExcalidrawElement[]
      byId = new Map(document.elements.map((item) => [item.id, item]))
      continue
    } else if (type === 'set_animation_group') {
      document.elements = updateAnimationDefinition(
        document.elements as never,
        [element.id],
        {
          group: operation.groupId
            ? {
                id: String(operation.groupId),
                order: Number(operation.order ?? 0),
                intervalMs: Number(operation.intervalMs ?? 0),
                direction: operation.direction === 'reverse' ? 'reverse' : 'forward',
              }
            : null,
        },
      ) as unknown as ExcalidrawElement[]
      byId = new Map(document.elements.map((item) => [item.id, item]))
      continue
    } else if (type === 'clear_animation') {
      if (element.customData) delete element.customData.sanverseAnimation
    } else if (type === 'set_scene' && element.type === 'frame') {
      document.elements = updateSceneDefinition(
        document.elements as never,
        element.id,
        {
          name: operation.name === undefined ? undefined : String(operation.name),
          order: operation.order === undefined ? undefined : Number(operation.order),
          durationMs: operation.durationMs === undefined
            ? undefined
            : Number(operation.durationMs),
        },
      ) as unknown as ExcalidrawElement[]
      byId = new Map(document.elements.map((item) => [item.id, item]))
      continue
    } else if (type === 'set_camera_track' && element.type === 'frame') {
      document.elements = updateSceneDefinition(
        document.elements as never,
        element.id,
        { camera: operation.camera as never },
      ) as unknown as ExcalidrawElement[]
      byId = new Map(document.elements.map((item) => [item.id, item]))
      continue
    } else if (type === 'move_element') {
      const x = Number(operation.x)
      const y = Number(operation.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid position.')
      element.x = x
      element.y = y
    } else if (type === 'update_element') {
      if (!operation.patch || typeof operation.patch !== 'object' || Array.isArray(operation.patch)) {
        throw new Error('update_element requires a patch object.')
      }
      const editable = operation.patch as Record<string, unknown>
      validateEditablePatch(editable)
      Object.assign(element, editable)
      if (element.type === 'text' && Object.hasOwn(editable, 'text')) {
        element.rawText = element.text
        element.originalText = element.text
      }
    } else if (type === 'duplicate_element') {
      const newId = String(operation.newElementId ?? '')
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(newId) || byId.has(newId)) {
        throw new Error(`Invalid or duplicate element id: ${newId}`)
      }
      const duplicate = structuredClone(element)
      duplicate.id = newId
      duplicate.x = Number.isFinite(operation.x) ? Number(operation.x) : Number(element.x) + 40
      duplicate.y = Number.isFinite(operation.y) ? Number(operation.y) : Number(element.y) + 40
      duplicate.boundElements = null
      bumpElement(duplicate)
      document.elements.push(duplicate)
      byId.set(newId, duplicate)
      continue
    } else if (type === 'delete_element') {
      element.isDeleted = true
    } else if (type === 'reorder_element') {
      const index = Math.max(0, Math.min(document.elements.length - 1, Math.trunc(Number(operation.index))))
      if (!Number.isFinite(index)) throw new Error('Invalid reorder index.')
      document.elements = document.elements.filter((item) => item.id !== element.id)
      document.elements.splice(index, 0, element)
      byId = new Map(document.elements.map((item) => [item.id, item]))
      bumpElement(element)
      continue
    } else if (type === 'set_bindings' && (element.type === 'arrow' || element.type === 'line')) {
      for (const side of ['start', 'end'] as const) {
        const targetId = operation[`${side}ElementId`]
        element[`${side}Binding`] = targetId
          ? { elementId: String(targetId), focus: 0, gap: 8, fixedPoint: null }
          : null
      }
    } else if (type === 'set_excalidraw_groups') {
      const groupIds = operation.groupIds
      if (!Array.isArray(groupIds) || groupIds.some((id) => typeof id !== 'string')) {
        throw new Error('groupIds must be a string array.')
      }
      element.groupIds = [...groupIds]
    } else {
      throw new Error(`Unsupported revision operation: ${type}`)
    }
    bumpElement(element)
  }
  const validation = validateAnimationDocument(document)
  if (!validation.valid) throw new Error(validation.errors.join(' '))
  return document
}

export const reviseAnimationFile = async (
  outputDir: string,
  filename: string,
  operations: Array<Record<string, unknown>>,
) => {
  const document = applyRevisionOperations(
    await readAnimationFile(outputDir, filename),
    operations,
  )
  await atomicJsonWrite(safeOutputPath(outputDir, filename), document)
  return {
    status: 'revised',
    ...summarizeAnimationDocument(filename, document),
    operationsApplied: operations.length,
  }
}

export const listAnimationFiles = async (outputDir: string) => {
  await mkdir(outputDir, { recursive: true })
  return (await readdir(outputDir))
    .filter((name) => /^[A-Za-z0-9._-]+\.excalidraw$/i.test(name))
    .sort()
}
