import { Bone, Euler, Object3D, Quaternion, Vector3 } from "three";

type AimOpts = {
  maxYaw: number; // radians
  maxPitch: number; // radians
  strength: number; // smoothing rate (higher = snappier)
};

type FocusManagerOptions = {
  neck?: AimOpts;
  head?: AimOpts;
  eyes?: AimOpts;
  forwardAxis?: "+Z" | "-Z";
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export class FocusManager {
  private head: Bone | null = null;
  private neck: Bone | null = null;
  private leftEye: Bone | null = null;
  private rightEye: Bone | null = null;

  // Smoothed desired offsets (relative offsets, not absolute targets)
  private offsetNeck = new Quaternion();
  private offsetHead = new Quaternion();
  private offsetLeftEye = new Quaternion();
  private offsetRightEye = new Quaternion();

  // Last-applied offsets (used to prevent accumulation)
  private appliedNeck = new Quaternion();
  private appliedHead = new Quaternion();
  private appliedLeftEye = new Quaternion();
  private appliedRightEye = new Quaternion();

  private tmpBoneWorld = new Vector3();
  private tmpDirWorld = new Vector3();
  private tmpDirLocal = new Vector3();
  private tmpParentWorldQ = new Quaternion();
  private tmpInvParentWorldQ = new Quaternion();
  private tmpEuler = new Euler();
  private tmpOffsetTarget = new Quaternion();

  private tmpInvApplied = new Quaternion();
  private tmpBase = new Quaternion();

  private opts: Required<Pick<FocusManagerOptions, "neck" | "head" | "eyes" | "forwardAxis">>;

  constructor(options?: FocusManagerOptions) {
    this.opts = {
      neck: options?.neck ?? { maxYaw: 0.35, maxPitch: 0.25, strength: 10 },
      head: options?.head ?? { maxYaw: 0.55, maxPitch: 0.35, strength: 12 },
      // keep eyes tighter by default to avoid weirdness
      eyes: options?.eyes ?? { maxYaw: 0.35, maxPitch: 0.2, strength: 1000 },
      forwardAxis: options?.forwardAxis ?? "+Z",
    };

    this.offsetNeck.identity();
    this.offsetHead.identity();
    this.offsetLeftEye.identity();
    this.offsetRightEye.identity();

    this.appliedNeck.identity();
    this.appliedHead.identity();
    this.appliedLeftEye.identity();
    this.appliedRightEye.identity();
  }

  attachToAvatar(root: Object3D) {
    this.head = null;
    this.neck = null;
    this.leftEye = null;
    this.rightEye = null;

    root.traverse((obj) => {
      const anyObj = obj as any;
      if (!anyObj.isBone) return;

      const name = (anyObj.name || "").toLowerCase();

      if (!this.head && (name === "head" || name.includes("head"))) this.head = anyObj;
      if (!this.neck && (name === "neck" || name.includes("neck"))) this.neck = anyObj;

      if (
        !this.leftEye &&
        (name === "eyeleft" ||
          name === "lefteye" ||
          name.includes("left_eye") ||
          name.includes("eye_l") ||
          name.endsWith("eyeleft"))
      ) {
        this.leftEye = anyObj;
      }

      if (
        !this.rightEye &&
        (name === "eyeright" ||
          name === "righteye" ||
          name.includes("right_eye") ||
          name.includes("eye_r") ||
          name.endsWith("eyeright"))
      ) {
        this.rightEye = anyObj;
      }
    });

    // reset offsets so we do not inherit old state
    this.offsetNeck.identity();
    this.offsetHead.identity();
    this.offsetLeftEye.identity();
    this.offsetRightEye.identity();

    this.appliedNeck.identity();
    this.appliedHead.identity();
    this.appliedLeftEye.identity();
    this.appliedRightEye.identity();

    // eslint-disable-next-line no-console
    console.log("Focus bones:", {
      neck: this.neck?.name,
      head: this.head?.name,
      leftEye: this.leftEye?.name,
      rightEye: this.rightEye?.name,
    });
  }

  update(delta: number, worldTarget: Vector3) {
    if (this.neck) {
      this.aimBoneOffset(this.neck, worldTarget, this.opts.neck, this.offsetNeck, delta, 0.15);
      this.applyOffsetNoAccumulation(this.neck, this.offsetNeck, this.appliedNeck);
    }

    if (this.head) {
      this.aimBoneOffset(this.head, worldTarget, this.opts.head, this.offsetHead, delta, 0.15);
      this.applyOffsetNoAccumulation(this.head, this.offsetHead, this.appliedHead);
    }

    // Eyes last, no downward bias, tighter ranges by default
    if (this.leftEye) {
      this.aimBoneOffset(this.leftEye, worldTarget, this.opts.eyes, this.offsetLeftEye, delta, 0.0);
      this.applyOffsetNoAccumulation(this.leftEye, this.offsetLeftEye, this.appliedLeftEye);
    }

    if (this.rightEye) {
      this.aimBoneOffset(this.rightEye, worldTarget, this.opts.eyes, this.offsetRightEye, delta, 0.0);
      this.applyOffsetNoAccumulation(this.rightEye, this.offsetRightEye, this.appliedRightEye);
    }
  }

  private aimBoneOffset(
    bone: Bone,
    worldTarget: Vector3,
    opts: AimOpts,
    smoothOffset: Quaternion,
    delta: number,
    downBias: number
  ) {
    const parent = bone.parent as Object3D | null;
    if (!parent) return;

    bone.getWorldPosition(this.tmpBoneWorld);
    this.tmpDirWorld.copy(worldTarget).sub(this.tmpBoneWorld).normalize();

    parent.getWorldQuaternion(this.tmpParentWorldQ);
    this.tmpInvParentWorldQ.copy(this.tmpParentWorldQ).invert();

    this.tmpDirLocal.copy(this.tmpDirWorld).applyQuaternion(this.tmpInvParentWorldQ);

    const z = this.opts.forwardAxis === "+Z" ? this.tmpDirLocal.z : -this.tmpDirLocal.z;

    const yaw = Math.atan2(this.tmpDirLocal.x, z);
    const pitch = Math.atan2(-this.tmpDirLocal.y, Math.sqrt(this.tmpDirLocal.x * this.tmpDirLocal.x + z * z)) + downBias;

    const cyaw = clamp(yaw, -opts.maxYaw, opts.maxYaw);
    const cpitch = clamp(pitch, -opts.maxPitch, opts.maxPitch);

    this.tmpEuler.set(cpitch, cyaw, 0, "YXZ");
    this.tmpOffsetTarget.setFromEuler(this.tmpEuler);

    // smooth offset
    const t = 1 - Math.exp(-opts.strength * Math.max(0, delta));
    smoothOffset.slerp(this.tmpOffsetTarget, t);
  }

  private applyOffsetNoAccumulation(bone: Bone, offset: Quaternion, lastApplied: Quaternion) {
    // base = current * inverse(lastApplied)
    // then set current = base * offset
    this.tmpInvApplied.copy(lastApplied).invert();
    this.tmpBase.copy(bone.quaternion).multiply(this.tmpInvApplied);

    bone.quaternion.copy(this.tmpBase).multiply(offset).normalize();

    // store what we applied this frame
    lastApplied.copy(offset);
  }
}
