import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from '@iwsdk/core';

/**
 * The virtual desk the diorama sits on. Its origin is the centre of the desk
 * top, so placing the desk places the work surface. The legs run 1.5 m down so
 * the desk still meets the floor when it is raised for someone standing; any
 * extra length is hidden under the floor.
 */
export const DESK_WIDTH = 1.2;
export const DESK_DEPTH = 0.7;

export function createDesk(): Group {
  const top = new Mesh(
    new BoxGeometry(DESK_WIDTH, 0.03, DESK_DEPTH),
    new MeshStandardMaterial({ color: '#24262d', roughness: 0.55, metalness: 0.1 }),
  );
  top.position.y = -0.015;

  // A thin lit strip along the front edge so the desk reads in the dark.
  const strip = new Mesh(
    new BoxGeometry(DESK_WIDTH - 0.04, 0.003, 0.003),
    new MeshBasicMaterial({ color: '#4fd1c5' }),
  );
  strip.position.set(0, -0.004, DESK_DEPTH / 2 + 0.0015);

  const legMaterial = new MeshStandardMaterial({ color: '#16171b', roughness: 0.7 });
  const legGeometry = new BoxGeometry(0.04, 1.5, 0.04);
  const desk = new Group();
  desk.add(top, strip);
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const leg = new Mesh(legGeometry, legMaterial);
      leg.position.set(x * (DESK_WIDTH / 2 - 0.05), -0.03 - 0.75, z * (DESK_DEPTH / 2 - 0.05));
      desk.add(leg);
    }
  }
  return desk;
}

/** A large dark floor; the scene's DomeFade blends its edge into the sky. */
export function createFloor(size = 40): Group {
  const floor = new Mesh(
    new PlaneGeometry(size, size),
    new MeshStandardMaterial({ color: '#121419', roughness: 0.92 }),
  );
  floor.rotation.x = -Math.PI / 2;
  const root = new Group();
  root.add(floor);
  return root;
}
