import { PokeInteractable, RayInteractable, type World } from '@iwsdk/core';

/**
 * Shows or hides a scene-placed panel. A hidden panel must also stop being
 * interactable, or it keeps catching rays and pokes meant for what is behind it.
 */
export function setPanelShown(world: World, nodeId: string, shown: boolean): void {
  const object = world.getSceneObject(nodeId);
  if (object) object.visible = shown;
  const entity = world.getSceneEntity(nodeId);
  if (!entity) return;
  if (shown) {
    if (!entity.hasComponent(RayInteractable)) entity.addComponent(RayInteractable);
    if (!entity.hasComponent(PokeInteractable)) entity.addComponent(PokeInteractable);
  } else {
    if (entity.hasComponent(RayInteractable)) entity.removeComponent(RayInteractable);
    if (entity.hasComponent(PokeInteractable)) entity.removeComponent(PokeInteractable);
  }
}
