#!/usr/bin/env node
// Downloads the room props from Poly Haven (all CC0) into public/models/props/,
// at 1K texture resolution to keep them light for Quest, and writes CREDITS.md.
//
// usage: node scripts/fetch-props.mjs

import fs from 'node:fs';
import path from 'node:path';

const PROPS = [
  'CashRegister_01',
  'metal_office_desk',
  'plastic_monobloc_chair_01',
  'steel_frame_shelves_01',
  'wooden_display_shelves_01',
  'wooden_bookshelf_worn',
  'painted_wooden_cabinet',
  'vintage_wooden_drawer_01',
  'wooden_crate_01',
  'plastic_crate_02',
  'potted_plant_04',
  'planter_pot_clay',
  'industrial_pipe_lamp',
  'wall_clock',
  'metal_toolbox',
  'power_box_01',
  'WetFloorSign_01',
  'side_table_01',
  'sofa_02',
];

const OUT = path.resolve('public/models/props');
const credits = ['# Prop credits', '', 'All props are from [Poly Haven](https://polyhaven.com) and licensed CC0 1.0.', ''];

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

let total = 0;
for (const id of PROPS) {
  const [files, info] = await Promise.all([
    json(`https://api.polyhaven.com/files/${id}`),
    json(`https://api.polyhaven.com/info/${id}`),
  ]);
  const gltf = files.gltf?.['1k']?.gltf;
  if (!gltf) {
    console.warn(`skip ${id}: no 1k glTF`);
    continue;
  }
  const dir = path.join(OUT, id);
  await download(gltf.url, path.join(dir, `${id}.gltf`));
  let bytes = gltf.size;
  for (const [rel, part] of Object.entries(gltf.include)) {
    await download(part.url, path.join(dir, rel));
    bytes += part.size;
  }
  total += bytes;
  credits.push(`- **${info.name}** (\`${id}\`) by ${Object.keys(info.authors).join(', ')}: https://polyhaven.com/a/${id}`);
  console.log(`${id}  ${(bytes / 1e6).toFixed(2)} MB  ${info.polycount ?? '?'} tris`);
}
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), credits.join('\n') + '\n');
console.log(`total ${(total / 1e6).toFixed(1)} MB`);
