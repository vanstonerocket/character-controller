import type { Object3D } from "three";

type BlinkTarget = { mesh: any; left: number; right: number };

export type BlinkManagerOptions = {
  minInterval?: number; // seconds
  maxInterval?: number; // seconds
  speed?: number; // eyelid close/open speed
  intensity?: number; // 0..1
};

export class BlinkManager {
  private targets: BlinkTarget[] = [];

  private timer = 0;
  private nextBlink = 3;

  private value = 0; // 0..1
  private closing = false;

  private minInterval: number;
  private maxInterval: number;
  private speed: number;
  private intensity: number;

  constructor(opts?: BlinkManagerOptions) {
    this.minInterval = opts?.minInterval ?? 2.5;
    this.maxInterval = opts?.maxInterval ?? 6.0;
    this.speed = opts?.speed ?? 12;
    this.intensity = opts?.intensity ?? 1.0;
    this.nextBlink = this.randomInterval();
  }

  attachToAvatar(root: Object3D) {
    const collected: BlinkTarget[] = [];

    root.traverse((obj: any) => {
      if (!obj?.morphTargetDictionary || !obj?.morphTargetInfluences) return;

      const left = obj.morphTargetDictionary["eyeBlinkLeft"];
      const right = obj.morphTargetDictionary["eyeBlinkRight"];

      if (left !== undefined && right !== undefined) {
        collected.push({ mesh: obj, left, right });
      }
    });

    this.targets = collected;

    console.log("BlinkManager targets:", collected.length);

    this.timer = 0;
    this.value = 0;
    this.closing = false;
    this.nextBlink = this.randomInterval();
    this.apply(0);
  }

  update(delta: number) {
    if (this.targets.length === 0) return;

    this.timer += delta;

    // Start blink if idle and interval reached
    if (!this.closing && this.value === 0 && this.timer >= this.nextBlink) {
      this.timer = 0;
      this.nextBlink = this.randomInterval();
      this.closing = true;
    }

    // Not blinking
    if (!this.closing && this.value === 0) return;

    // Animate eyelids
    if (this.closing) {
      this.value += delta * this.speed;
      if (this.value >= 1) {
        this.value = 1;
        this.closing = false; // begin opening
      }
    } else {
      this.value -= delta * this.speed;
      if (this.value <= 0) {
        this.value = 0; // finished
      }
    }

    this.apply(this.value);
  }

  blinkNow() {
    this.timer = 0;
    this.closing = true;
  }

  onLand() {
    if (Math.random() < 0.35) this.blinkNow();
  }

  setIntensity(v: number) {
    this.intensity = Math.max(0, Math.min(1, v));
  }

  private apply(v01: number) {
    const v = v01 * this.intensity;
    for (const { mesh, left, right } of this.targets) {
      mesh.morphTargetInfluences[left] = v;
      mesh.morphTargetInfluences[right] = v;
    }
  }

  private randomInterval() {
    return this.minInterval + Math.random() * (this.maxInterval - this.minInterval);
  }
}
