import { AssetManager, Box3, Group, type Object3D, Vector3 } from '@iwsdk/core';

/**
 * Photo-scanned props from Poly Haven (CC0; see public/models/props/CREDITS.md),
 * loaded on demand: a room asks for the props it needs before it is built, so
 * the headset only downloads what the rooms you visit actually use.
 */

export type PropId =
  | 'CashRegister_01'
  | 'metal_office_desk'
  | 'plastic_monobloc_chair_01'
  | 'steel_frame_shelves_01'
  | 'wooden_display_shelves_01'
  | 'wooden_bookshelf_worn'
  | 'painted_wooden_cabinet'
  | 'vintage_wooden_drawer_01'
  | 'wooden_crate_01'
  | 'plastic_crate_02'
  | 'potted_plant_04'
  | 'planter_pot_clay'
  | 'industrial_pipe_lamp'
  | 'wall_clock'
  | 'metal_toolbox'
  | 'power_box_01'
  | 'WetFloorSign_01'
  | 'side_table_01'
  | 'sofa_02';

const key = (id: PropId) => `prop:${id}`;
const url = (id: PropId) => `${import.meta.env.BASE_URL}models/props/${id}/${id}.gltf`;
const loading = new Map<PropId, Promise<void>>();
const loaded = new Set<PropId>();

/** Loads props (once each). Failures are logged; a missing prop is simply left out. */
export function loadProps(ids: Iterable<PropId>): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const id of new Set(ids)) {
    if (loaded.has(id)) continue;
    let job = loading.get(id);
    if (!job) {
      job = AssetManager.loadGLTF(url(id), key(id))
        .then(() => {
          loaded.add(id);
        })
        .catch((e: unknown) => console.warn(`[props] could not load ${id}:`, e));
      loading.set(id, job);
    }
    jobs.push(job);
  }
  return Promise.all(jobs).then(() => undefined);
}

const size = new Vector3();
const box = new Box3();

/**
 * A fresh copy of a loaded prop, scaled so its height (or its longest side,
 * with `fit: 'longest'`) matches `target` meters, with its base on y = 0 and
 * centred on x/z. Returns an empty group if the prop isn't loaded.
 */
export function prop(id: PropId, target?: number, fit: 'height' | 'longest' = 'height'): Group {
  const holder = new Group();
  const gltf = loaded.has(id) ? AssetManager.getGLTF(key(id)) : null;
  if (!gltf) return holder;
  const model: Object3D = gltf.scene;
  holder.add(model);
  model.updateWorldMatrix(true, true);
  box.setFromObject(model).getSize(size);
  if (target) {
    const current = fit === 'height' ? size.y : Math.max(size.x, size.y, size.z);
    if (current > 1e-4) model.scale.multiplyScalar(target / current);
  }
  model.updateWorldMatrix(true, true);
  box.setFromObject(model);
  const center = box.getCenter(new Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
  return holder;
}

/** The footprint and height of a prop copy, after fitting. */
export function propSize(object: Object3D): Vector3 {
  object.updateWorldMatrix(true, true);
  return new Box3().setFromObject(object).getSize(new Vector3());
}
