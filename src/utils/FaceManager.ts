import type { Object3D, Vector3 } from "three";
import { BlinkManager, type BlinkManagerOptions } from "./BlinkManager";
import { FocusManager } from "./FocusManager";

export type FaceManagerOptions = {
  blink?: BlinkManagerOptions;
  focus?: ConstructorParameters<typeof FocusManager>[0];
};

export class FaceManager {
  private blink: BlinkManager;
  private focus: FocusManager;

  constructor(opts?: FaceManagerOptions) {
    this.blink = new BlinkManager(opts?.blink);
    this.focus = new FocusManager(opts?.focus);
  }

  attachToAvatar(root: Object3D) {
    this.blink.attachToAvatar(root);
    this.focus.attachToAvatar(root);
  }

  update(delta: number, lookTargetWorld: Vector3) {
    this.blink.update(delta);
    this.focus.update(delta, lookTargetWorld);
  }

  blinkNow() {
    this.blink.blinkNow();
  }

  onLand() {
    this.blink.onLand();
  }

  setBlinkIntensity(v: number) {
    this.blink.setIntensity(v);
  }
}
