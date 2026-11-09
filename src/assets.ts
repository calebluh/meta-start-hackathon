import { AssetType, defineAssets } from '@iwsdk/core';
import { createDesk, createFloor } from './scene-assets/desk.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

const uikitml = (fileName: string, name: string) => ({
  url: publicAssetUrl(`ui/${fileName}`),
  type: AssetType.UIKitML,
  name,
});

export default defineAssets({
  floor: createFloor(),
  desk: createDesk(),
  inspector: uikitml('inspector.uikitml', 'Inspector Panel'),
  controls: uikitml('controls.uikitml', 'Controls Panel'),
  ask: uikitml('ask.uikitml', 'Ask Panel'),
  // CC0 RobotExpressive by Tomás Laulhé (Quaternius), via the three.js examples.
  'worker-robot': { url: publicAssetUrl('models/robot-expressive.glb'), type: AssetType.GLTF, name: 'Worker robot' },
});
