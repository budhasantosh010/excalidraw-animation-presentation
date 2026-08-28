import { z } from 'zod'

import { MAX_ANIMATION_STEP } from '../src/animation.ts'

export const animationEffectSchema = z.enum([
  'auto',
  'appear',
  'fade',
  'pop',
  'draw',
])

const elementIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)
const finiteNumberSchema = z.number().finite()
const animationSchema = z.object({
  step: z.number().int().min(1).max(MAX_ANIMATION_STEP),
  effect: animationEffectSchema,
}).strict()
const storyboardGeometry = {
  id: elementIdSchema,
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  width: finiteNumberSchema.nonnegative(),
  height: finiteNumberSchema.nonnegative(),
  text: z.string().optional(),
  startElementId: elementIdSchema.optional(),
  endElementId: elementIdSchema.optional(),
  style: z.record(z.unknown()).optional(),
  animation: animationSchema,
}

export const storyboardElementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rectangle'), ...storyboardGeometry }).strict(),
  z.object({ type: z.literal('ellipse'), ...storyboardGeometry }).strict(),
  z.object({ type: z.literal('diamond'), ...storyboardGeometry }).strict(),
  z.object({ type: z.literal('text'), ...storyboardGeometry }).strict(),
  z.object({ type: z.literal('arrow'), ...storyboardGeometry }).strict(),
  z.object({ type: z.literal('line'), ...storyboardGeometry }).strict(),
])

export const storyboardSchema = z.object({
  projectName: z.string().trim().min(1),
  scenes: z.array(z.object({
    sceneId: z.string().trim().min(1),
    title: z.string(),
    elements: z.array(storyboardElementSchema),
  }).strict()).min(1).max(20),
}).strict()

const editablePatchSchema = z.object({
  x: finiteNumberSchema.optional(),
  y: finiteNumberSchema.optional(),
  width: finiteNumberSchema.nonnegative().optional(),
  height: finiteNumberSchema.nonnegative().optional(),
  angle: finiteNumberSchema.optional(),
  strokeColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  fillStyle: z.string().optional(),
  strokeWidth: finiteNumberSchema.optional(),
  strokeStyle: z.string().optional(),
  roughness: finiteNumberSchema.optional(),
  opacity: finiteNumberSchema.min(0).max(100).optional(),
  locked: z.boolean().optional(),
  text: z.string().optional(),
  fontSize: finiteNumberSchema.optional(),
  fontFamily: finiteNumberSchema.optional(),
  textAlign: z.string().optional(),
  verticalAlign: z.string().optional(),
}).strict()

const animationTransformSchema = z.object({
  x: finiteNumberSchema.optional(),
  y: finiteNumberSchema.optional(),
  scale: finiteNumberSchema.positive().optional(),
  rotate: finiteNumberSchema.optional(),
  opacity: finiteNumberSchema.min(0).max(100).optional(),
}).strict()

const rawExcalidrawElementSchema = z.object({
  id: elementIdSchema,
  type: z.string().min(1),
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  width: finiteNumberSchema.nonnegative(),
  height: finiteNumberSchema.nonnegative(),
}).passthrough()

export const revisionOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_element'), element: rawExcalidrawElementSchema }).strict(),
  z.object({ type: z.literal('change_text'), elementId: elementIdSchema, text: z.string() }).strict(),
  z.object({
    type: z.literal('set_animation_step'),
    elementId: elementIdSchema,
    step: z.number().int().min(1).max(MAX_ANIMATION_STEP),
  }).strict(),
  z.object({
    type: z.literal('set_animation_effect'),
    elementId: elementIdSchema,
    effect: animationEffectSchema,
  }).strict(),
  z.object({
    type: z.literal('set_animation_timing'),
    elementId: elementIdSchema,
    durationMs: finiteNumberSchema.min(50).max(120_000),
    delayMs: finiteNumberSchema.min(0).max(120_000).optional(),
    easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']).optional(),
    phase: z.enum(['entrance', 'emphasis', 'exit']).optional(),
    transform: animationTransformSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('set_animation_group'),
    elementId: elementIdSchema,
    groupId: z.string().min(1).optional(),
    order: z.number().int().optional(),
    intervalMs: finiteNumberSchema.min(0).optional(),
    direction: z.enum(['forward', 'reverse']).optional(),
  }).strict(),
  z.object({ type: z.literal('clear_animation'), elementId: elementIdSchema }).strict(),
  z.object({
    type: z.literal('set_scene'),
    elementId: elementIdSchema,
    name: z.string().optional(),
    order: z.number().int().optional(),
    durationMs: finiteNumberSchema.min(100).max(120_000).optional(),
  }).strict(),
  z.object({
    type: z.literal('set_camera_track'),
    elementId: elementIdSchema,
    camera: z.array(z.object({
      atMs: finiteNumberSchema.min(0),
      zoom: finiteNumberSchema.positive().optional(),
      scrollX: finiteNumberSchema.optional(),
      scrollY: finiteNumberSchema.optional(),
    }).strict()),
  }).strict(),
  z.object({
    type: z.literal('move_element'),
    elementId: elementIdSchema,
    x: finiteNumberSchema,
    y: finiteNumberSchema,
  }).strict(),
  z.object({
    type: z.literal('update_element'),
    elementId: elementIdSchema,
    patch: editablePatchSchema,
  }).strict(),
  z.object({
    type: z.literal('duplicate_element'),
    elementId: elementIdSchema,
    newElementId: elementIdSchema,
    x: finiteNumberSchema.optional(),
    y: finiteNumberSchema.optional(),
  }).strict(),
  z.object({ type: z.literal('delete_element'), elementId: elementIdSchema }).strict(),
  z.object({
    type: z.literal('reorder_element'),
    elementId: elementIdSchema,
    index: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    type: z.literal('set_bindings'),
    elementId: elementIdSchema,
    startElementId: elementIdSchema.nullable().optional(),
    endElementId: elementIdSchema.nullable().optional(),
  }).strict(),
  z.object({
    type: z.literal('set_excalidraw_groups'),
    elementId: elementIdSchema,
    groupIds: z.array(z.string()),
  }).strict(),
])

export const projectActionSchema = z.object({
  action: z.enum(['rename', 'duplicate', 'trash', 'restore', 'restore-revision']),
  name: z.string().optional(),
  targetWorkspaceId: z.string().optional(),
  revision: z.number().int().positive().optional(),
}).strict()

export const projectInspectionShape = {
  sceneId: z.string().optional(),
  elementIds: z.array(elementIdSchema).max(200).optional(),
  query: z.string().max(500).optional(),
  elementType: z.string().max(80).optional(),
  animationOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().max(500).optional(),
}

export type RevisionOperation = z.infer<typeof revisionOperationSchema>
export type TypedStoryboard = z.infer<typeof storyboardSchema>
