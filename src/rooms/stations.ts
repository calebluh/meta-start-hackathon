import { Group, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { prop, type PropId } from './props.js';
import type { DecorKind, Palette, StationKind, Theme } from './themes.js';
import { unitBox } from './themes.js';

/**
 * Stations and decor built from photo-scanned props where a good one exists.
 * Each builder returns null when it has no prop version, and the room falls
 * back to the procedural builder in themes.ts. Origins are on the floor, and
 * stations face +Z (toward the room centre).
 */

/** Props each station or decor piece needs, so a room can load them first. */
const STATION_PROPS: Partial<Record<StationKind, PropId[]>> = {
  rack: ['steel_frame_shelves_01', 'wooden_crate_01', 'plastic_crate_02'],
  pallets: ['wooden_crate_01', 'plastic_crate_02'],
  tallShelves: ['wooden_bookshelf_worn'],
  filingCabinet: ['vintage_wooden_drawer_01', 'planter_pot_clay'],
  cardCatalog: ['painted_wooden_cabinet', 'potted_plant_04'],
  register: ['CashRegister_01'],
  counter: ['CashRegister_01'],
  accountingDesk: ['metal_office_desk', 'plastic_monobloc_chair_01'],
  desk: ['metal_office_desk', 'plastic_monobloc_chair_01', 'industrial_pipe_lamp'],
  readingDesk: ['metal_office_desk', 'plastic_monobloc_chair_01', 'industrial_pipe_lamp'],
  sortingTable: ['metal_office_desk'],
  operatorDesk: ['metal_office_desk', 'plastic_monobloc_chair_01'],
  radioDesk: ['metal_office_desk', 'plastic_monobloc_chair_01'],
  monitors: ['metal_office_desk', 'plastic_monobloc_chair_01'],
  workbench: ['metal_toolbox'],
  display: ['wooden_display_shelves_01'],
  toolWall: ['metal_toolbox'],
  fuseBox: ['power_box_01'],
};

const DECOR_PROPS: Partial<Record<DecorKind, PropId[]>> = {
  plant: ['potted_plant_04'],
  chair: ['plastic_monobloc_chair_01'],
  crateStack: ['wooden_crate_01', 'plastic_crate_02'],
  sofa: ['sofa_02', 'side_table_01'],
  clock: ['wall_clock'],
  wetFloor: ['WetFloorSign_01'],
};

export function propsForTheme(theme: Theme): PropId[] {
  return [
    ...theme.stations.flatMap((s) => STATION_PROPS[s] ?? []),
    ...theme.decor.flatMap((d) => DECOR_PROPS[d] ?? []),
  ];
}

function place(parent: Group, child: Group, x: number, y: number, z: number, yaw = 0): Group {
  child.position.set(x, y, z);
  child.rotation.y = yaw;
  parent.add(child);
  return child;
}

function box(parent: Group, m: MeshStandardMaterial, w: number, h: number, d: number, x: number, y: number, z: number, tilt = 0): Mesh {
  const mesh = new Mesh(unitBox, m);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y + h / 2, z);
  mesh.rotation.x = tilt;
  parent.add(mesh);
  return mesh;
}

/** A computer monitor with a lit screen, standing on a surface at height y. */
function monitor(g: Group, p: Palette, x: number, y: number, z: number, w = 0.55, yaw = 0): void {
  const stand = box(g, p.dark, 0.05, 0.12, 0.05, x, y, z - 0.02);
  stand.rotation.y = yaw;
  const frame = box(g, p.dark, w, w * 0.6, 0.035, x, y + 0.12, z);
  frame.rotation.y = yaw;
  const screen = box(g, p.screen, w * 0.92, w * 0.52, 0.005, x, y + 0.14, z + 0.02);
  screen.rotation.y = yaw;
}

const DESK_TOP = 0.79; // height of metal_office_desk

/** The scanned office desk with a chair pulled up on the viewer's side. */
function officeDesk(g: Group, withChair = true): void {
  place(g, prop('metal_office_desk', DESK_TOP), 0, 0, 0);
  if (withChair) place(g, prop('plastic_monobloc_chair_01', 0.88), 0.25, 0, 0.72, Math.PI);
}

export function makePropStation(kind: StationKind, p: Palette): Group | null {
  if (!STATION_PROPS[kind]) return null;
  const g = new Group();
  switch (kind) {
    case 'rack':
      place(g, prop('steel_frame_shelves_01', 2.1), 0, 0, -0.1);
      place(g, prop('wooden_crate_01', 0.8, 'longest'), -1.15, 0, 0.1, 0.2);
      place(g, prop('wooden_crate_01', 0.8, 'longest'), -1.1, 0.34, 0.05, -0.1);
      place(g, prop('plastic_crate_02', 0.5, 'longest'), 1.15, 0, 0.15, -0.3);
      break;
    case 'pallets': {
      box(g, p.wood, 1.3, 0.12, 1.05, 0, 0, 0);
      place(g, prop('wooden_crate_01', 0.8, 'longest'), -0.2, 0.12, -0.2);
      place(g, prop('wooden_crate_01', 0.8, 'longest'), -0.2, 0.46, -0.2, 0.15);
      place(g, prop('plastic_crate_02', 0.5, 'longest'), 0.35, 0.12, 0.25, 0.4);
      break;
    }
    case 'tallShelves':
      place(g, prop('wooden_bookshelf_worn', 2.06), 0, 0, -0.1);
      break;
    case 'filingCabinet':
      place(g, prop('vintage_wooden_drawer_01', 1.09), 0, 0, -0.1);
      place(g, prop('planter_pot_clay', 0.3), -0.55, 1.09, -0.1);
      for (let i = 0; i < 3; i += 1) box(g, p.paper, 0.3, 0.012, 0.22, 0.35, 1.09 + i * 0.013, -0.1);
      break;
    case 'cardCatalog':
      place(g, prop('painted_wooden_cabinet', 1.18), 0, 0, -0.1);
      place(g, prop('potted_plant_04', 0.35), 0.35, 1.18, -0.1);
      break;
    case 'register':
      // A shop counter with the scanned till on top.
      box(g, p.wood, 1.8, 1.0, 0.6, 0, 0, 0);
      box(g, p.accent, 1.84, 0.04, 0.64, 0, 1.0, 0);
      place(g, prop('CashRegister_01', 0.42), 0.35, 1.04, 0, Math.PI);
      for (let i = 0; i < 4; i += 1) box(g, p.paper, 0.08, 0.004, 0.2, -0.5 + i * 0.03, 1.04 + i * 0.005, 0.05);
      break;
    case 'counter':
      box(g, p.wood, 1.8, 1.0, 0.6, 0, 0, 0);
      box(g, p.accent, 1.84, 0.04, 0.64, 0, 1.0, 0);
      place(g, prop('CashRegister_01', 0.42), 0.45, 1.04, 0, Math.PI);
      break;
    case 'accountingDesk':
      officeDesk(g);
      monitor(g, p, -0.4, DESK_TOP, -0.2);
      box(g, p.dark, 0.26, 0.06, 0.3, 0.35, DESK_TOP, 0.05); // adding machine
      box(g, p.paper, 0.1, 0.16, 0.01, 0.35, DESK_TOP + 0.06, -0.08, -0.3);
      for (let i = 0; i < 5; i += 1) box(g, p.paper, 0.22, 0.012, 0.3, 0.7, DESK_TOP + i * 0.013, 0.05);
      break;
    case 'desk':
      officeDesk(g);
      monitor(g, p, -0.3, DESK_TOP, -0.2);
      place(g, prop('industrial_pipe_lamp', 0.36), 0.7, DESK_TOP, -0.2, Math.PI);
      box(g, p.paper, 0.3, 0.02, 0.22, 0.25, DESK_TOP, 0.1);
      break;
    case 'readingDesk':
      officeDesk(g);
      place(g, prop('industrial_pipe_lamp', 0.36), -0.7, DESK_TOP, -0.2, Math.PI);
      box(g, p.item, 0.3, 0.05, 0.4, 0.1, DESK_TOP, 0, 0);
      box(g, p.paper, 0.28, 0.06, 0.36, 0.5, DESK_TOP, -0.05);
      break;
    case 'sortingTable':
      officeDesk(g, false);
      for (let i = 0; i < 7; i += 1) box(g, p.item, 0.22, 0.012, 0.15, -0.75 + i * 0.25, DESK_TOP + (i % 2) * 0.012, -0.1 + (i % 3) * 0.12);
      break;
    case 'operatorDesk':
    case 'radioDesk':
      officeDesk(g);
      box(g, p.dark, 1.0, 0.32, 0.3, 0, DESK_TOP, -0.25);
      box(g, p.glow, 0.9, 0.1, 0.01, 0, DESK_TOP + 0.16, -0.095);
      if (kind === 'radioDesk') {
        box(g, p.metal, 0.02, 0.8, 0.02, 0.55, DESK_TOP, -0.3);
        for (let i = 0; i < 4; i += 1) box(g, p.accent, 0.05, 0.03, 0.05, -0.3 + i * 0.2, DESK_TOP, 0.12);
      }
      break;
    case 'monitors':
      officeDesk(g);
      for (let i = 0; i < 3; i += 1) monitor(g, p, -0.6 + i * 0.6, DESK_TOP, -0.2, 0.55, (1 - i) * 0.25);
      break;
    case 'workbench':
      box(g, p.wood, 1.6, 0.06, 0.75, 0, 0.84, 0);
      for (const x of [-0.75, 0.75]) for (const z of [-0.32, 0.32]) box(g, p.metal, 0.06, 0.84, 0.06, x, 0, z);
      box(g, p.wood, 1.5, 0.03, 0.65, 0, 0.25, 0);
      place(g, prop('metal_toolbox', 0.4, 'longest'), -0.45, 0.9, -0.05, 0.3);
      box(g, p.accent, 0.5, 0.05, 0.08, 0.35, 0.9, 0.1);
      break;
    case 'display':
      place(g, prop('wooden_display_shelves_01', 1.56), -0.5, 0, -0.1, Math.PI / 2);
      place(g, prop('wooden_display_shelves_01', 1.56), 0.6, 0, -0.1, Math.PI / 2);
      break;
    case 'toolWall':
      box(g, p.dark, 1.8, 1.8, 0.06, 0, 0.3, -0.2);
      for (let i = 0; i < 8; i += 1) box(g, i % 2 ? p.metal : p.accent, 0.06, 0.35 + (i % 3) * 0.1, 0.04, -0.7 + i * 0.2, 1.1, -0.15);
      place(g, prop('metal_toolbox', 0.45, 'longest'), 0.4, 0, 0.2, -0.4);
      break;
    case 'fuseBox':
      box(g, p.metal, 1.4, 2.0, 0.08, 0, 0, -0.2);
      place(g, prop('power_box_01', 0.7), -0.35, 0.8, -0.1);
      place(g, prop('power_box_01', 0.7), 0.35, 0.8, -0.1);
      break;
    default:
      return null;
  }
  return g;
}

export function makePropDecor(kind: DecorKind): Group | null {
  if (!DECOR_PROPS[kind]) return null;
  const g = new Group();
  switch (kind) {
    case 'plant':
      place(g, prop('potted_plant_04', 1.0), 0, 0, 0);
      break;
    case 'chair':
      place(g, prop('plastic_monobloc_chair_01', 0.88), 0, 0, 0, Math.PI);
      break;
    case 'crateStack':
      place(g, prop('wooden_crate_01', 0.8, 'longest'), 0, 0, 0);
      place(g, prop('plastic_crate_02', 0.5, 'longest'), 0.05, 0.34, 0, 0.3);
      break;
    case 'sofa':
      place(g, prop('sofa_02', 0.71), 0, 0, 0, Math.PI);
      place(g, prop('side_table_01', 0.45), 1.2, 0, 0);
      break;
    case 'clock':
      // Mounted on the wall: the room raises it and pushes it to the wall.
      place(g, prop('wall_clock', 0.45, 'longest'), 0, 0, 0, Math.PI);
      g.userData.wallHeight = 2.3;
      break;
    case 'wetFloor':
      place(g, prop('WetFloorSign_01', 0.63), 0, 0, 0, 0.6);
      break;
    default:
      return null;
  }
  return g;
}
