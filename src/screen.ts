import {
  BoxGeometry,
  createSystem,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
} from '@iwsdk/core';
import { app } from './state.js';

/**
 * Your computer's screen as a monitor standing behind the city (development
 * only). Open /share on the computer, pick a window or the whole screen, and
 * it appears here, so you can watch your coding agent work through the notes
 * without taking the headset off.
 *
 * A web page in VR cannot show the Quest's own Remote Desktop panels, so the
 * computer sends still frames (JPEG, a few a second) through the dev server's
 * /api/screen socket. A direct WebRTC link would be smoother, but desktop
 * browsers hide their local address, which often stops a direct link on a
 * home network; through the server it always connects. View only: you type on
 * your real keyboard.
 */

/** Width of the picture, in metres. */
const SCREEN_WIDTH = 0.85;
/** Centre of the picture's bottom edge, in the workspace's space (behind the board and above the guide card, a little left of the info panel). */
const SCREEN_X = -0.06;
const SCREEN_BOTTOM = 0.3;
const SCREEN_Z = -0.74;
const BEZEL = 0.018;
/** Try the socket again this long after it closes. */
const RETRY_MS = 3000;

export class ScreenSystem extends createSystem({}) {
  private group = new Group();
  private picture!: Mesh;
  private bezel!: Mesh;
  private texture = new Texture();
  private socket: WebSocket | null = null;
  private live = false;
  private decoding = false;
  private aspect = 16 / 9;
  private stopped = false;
  private retry: ReturnType<typeof setTimeout> | null = null;

  init(): void {
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.flipY = false; // the frames arrive already flipped (createImageBitmap)
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.picture = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.picture.name = 'shared-screen';
    this.bezel = new Mesh(new BoxGeometry(1, 1, 0.012), new MeshBasicMaterial({ color: 0x0b0f17 }));
    this.bezel.position.z = -0.008;
    this.group.add(this.bezel, this.picture);
    this.group.visible = false;
    this.fit();
    const workspace = this.world.getSceneEntity('workspace');
    this.world.createTransformEntity(this.group, workspace ? { parent: workspace, persistent: true } : { persistent: true });
    this.connect();
    this.cleanupFuncs.push(() => {
      this.stopped = true;
      if (this.retry) clearTimeout(this.retry);
      this.socket?.close();
      const image = this.texture.image as ImageBitmap | undefined;
      if (image && 'close' in image) image.close();
      this.texture.dispose();
    });
  }

  update(): void {
    const want = this.live && app.mode === 'table' && !app.menu && !app.street;
    if (want !== this.group.visible) this.group.visible = want;
  }

  /** Sizes the picture and its frame to the shared screen's shape. */
  private fit(): void {
    const height = SCREEN_WIDTH / this.aspect;
    this.picture.scale.set(SCREEN_WIDTH, height, 1);
    this.bezel.scale.set(SCREEN_WIDTH + BEZEL * 2, height + BEZEL * 2, 1);
    this.group.position.set(SCREEN_X, SCREEN_BOTTOM + height / 2, SCREEN_Z);
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/screen`);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.addEventListener('open', () => socket.send(JSON.stringify({ role: 'watch' })));
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data) as { live?: boolean };
          if (typeof message.live === 'boolean') {
            this.live = message.live;
            console.log(`[screen] ${message.live ? 'sharing' : 'not sharing'}`);
          }
        } catch {
          // not ours
        }
        return;
      }
      this.show(event.data as ArrayBuffer);
    });
    socket.addEventListener('close', () => {
      this.live = false;
      if (this.socket === socket) this.socket = null;
      if (!this.stopped) this.retry = setTimeout(() => this.connect(), RETRY_MS);
    });
  }

  /** Decodes one frame off the main thread and puts it on the monitor; frames that arrive meanwhile are skipped. */
  private show(data: ArrayBuffer): void {
    if (this.decoding) return;
    this.decoding = true;
    this.live = true;
    createImageBitmap(new Blob([data], { type: 'image/jpeg' }), { imageOrientation: 'flipY' })
      .then((bitmap) => {
        const old = this.texture.image as ImageBitmap | undefined;
        // A new size needs new GPU storage: drop the old, it is made again on the next draw.
        if (old && (old.width !== bitmap.width || old.height !== bitmap.height)) this.texture.dispose();
        this.texture.image = bitmap;
        this.texture.needsUpdate = true;
        if (old && old !== bitmap && 'close' in old) old.close();
        const aspect = bitmap.width / Math.max(bitmap.height, 1);
        if (Math.abs(aspect - this.aspect) > 0.01) {
          this.aspect = aspect;
          this.fit();
        }
      })
      .catch(() => {
        // a broken frame: wait for the next
      })
      .finally(() => {
        this.decoding = false;
      });
  }
}
