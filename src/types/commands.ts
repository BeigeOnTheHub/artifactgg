// src/types/commands.ts
import type { Hex } from './hex';
import type {
  Stroke,
  Shape,
  Cone,
  Player,
  TextBox,
  QuickAdd,
  ScannerPlacement,
  SelectionRef,
  ToolId,
  Frame,
} from './primitives';
import type { MapId } from './maps';

export type Command =
  | { t: 'tool.set'; tool: ToolId }
  | { t: 'map.select'; mapId: MapId }
  | { t: 'map._restore'; mapId: MapId; frames: Frame[]; activeFrameIdx: number; zoom: number; panX: number; panY: number; mapFrames: Partial<Record<MapId, { frames: Frame[]; activeFrameIdx: number }>>; selection: SelectionRef[] }
  | { t: 'view.zoom'; zoom: number; centreX?: number; centreY?: number }
  | { t: 'view.pan'; panX: number; panY: number }
  | { t: 'stroke.add'; stroke: Stroke }
  | { t: 'stroke.addMany'; strokes: Stroke[] }
  | { t: 'stroke.erase'; ids: string[] }
  | { t: 'stroke.modify'; id: string; before: Partial<Omit<Stroke, 'id'>>; after: Partial<Omit<Stroke, 'id'>> }
  | { t: 'shape.add'; shape: Shape }
  | { t: 'shape.addMany'; shapes: Shape[] }
  | { t: 'shape.modify'; id: string; before: Partial<Omit<Shape, 'id'>>; after: Partial<Omit<Shape, 'id'>> }
  | { t: 'shape.delete'; ids: string[] }
  | { t: 'cone.add'; cone: Cone }
  | { t: 'cone.addMany'; cones: Cone[] }
  | { t: 'cone.modify'; id: string; before: Partial<Omit<Cone, 'id'>>; after: Partial<Omit<Cone, 'id'>> }
  | { t: 'cone.delete'; ids: string[] }
  | { t: 'player.add'; player: Player }
  | { t: 'player.addMany'; players: Player[] }
  | { t: 'player.move'; id: string; x: number; y: number }
  | { t: 'player.modify'; id: string; before: Partial<Omit<Player, 'id'>>; after: Partial<Omit<Player, 'id'>> }
  | { t: 'player.delete'; ids: string[] }
  | { t: 'textbox.add'; box: TextBox }
  | { t: 'textbox.addMany'; boxes: TextBox[] }
  | { t: 'textbox.modify'; id: string; before: Partial<Omit<TextBox, 'id'>>; after: Partial<Omit<TextBox, 'id'>> }
  | { t: 'textbox.delete'; ids: string[] }
  | { t: 'quickadd.add'; qa: QuickAdd }
  | { t: 'quickadd.addMany'; quickadds: QuickAdd[] }
  | { t: 'quickadd.modify'; id: string; before: Partial<Omit<QuickAdd, 'id'>>; after: Partial<Omit<QuickAdd, 'id'>> }
  | { t: 'quickadd.delete'; ids: string[] }
  | { t: 'scanner.place'; scanner: ScannerPlacement | null }
  | { t: 'selection.set'; refs: SelectionRef[] }
  | { t: 'colour.setSlot'; slot: 0 | 1 | 2 | 3 | 4; hex: Hex | null }
  | { t: 'colour.activeSlot'; slot: 0 | 1 | 2 | 3 | 4 }
  | { t: 'colour.set'; slot: 0 | 1 | 2 | 3 | 4; before: Hex | null; after: Hex | null }
  | { t: 'frame.add' }
  | { t: 'frame.setDuration'; frameIdx: number; durationMs: number | undefined }
  | { t: 'frame.setCaption'; frameIdx: number; caption: string | undefined }
  | { t: 'frame.delete'; idx: number }
  | { t: 'frame.switch'; idx: number }
  | { t: 'frame.reorder'; from: number; to: number }
  | { t: 'frame.clear'; before: Frame }
  | { t: 'frame._restore'; idx: number; frame: Frame; activeFrameIdx: number; selection: SelectionRef[] }
  | { t: 'frame._removeLast'; activeFrameIdx: number; selection: SelectionRef[] }
  | { t: 'frame._switchRestore'; idx: number; selection: SelectionRef[] }
  | { t: 'frame._clearRestore'; idx: number; frame: Frame; selection: SelectionRef[] }
  | { t: 'notes.set'; notes: string }
  | { t: 'callouts.toggle'; visible: boolean }
  | { t: 'batch'; cmds: Command[] };

export type CommandT = Command['t'];
