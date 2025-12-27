import { Bone, Euler, Object3D, Quaternion, Vector3 } from "three";

type AimOpts = {
  maxYaw: number; // radians
  maxPitch: number; // radians
  strength: number; // 0..1 slerp per frame
};

type FocusManagerOptions = {
  neck?: AimOpts;
  head?: AimOpts;
  eyes?: AimOpts;
  // If your rig’s forward axis is not +Z, set this offset (rarely needed).
  // Most RPM glTF rigs work fine with the default.
  forwardAxis?: "+Z" | "-Z";
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/**
 * FocusManager
 * - Call attachToAvatar(scene) once after loading
 * - Call update(delta, worldTarget) every frame
 */
export class FocusManager {
  private head: Bone | null = null;
  private neck: Bone | null = null;
  private leftEye: Bone | null = null;
  private rightEye: Bone | null = null;

  private headRest: Quaternion | null = null;
  private neckRest: Quaternion | null = null;
  private leftEyeRest: Quaternion | null = null;
  private rightEyeRest: Quaternion | null = null;

  private tmpBoneWorld = new Vector3();
  private tmpDirWorld = new Vector3();
  private tmpParentWorldQ = new Quaternion();
  private tmpInvParentWorldQ = new Quaternion();
  private tmpOffsetQ = new Quaternion();
  private tmpTargetQ = new Quaternion();
  private tmpEuler = new Euler();

  private opts: Required<Pick<FocusManagerOptions, "neck" | "head" | "eyes" | "forwardAxis">>;

  constructor(options?: FocusManagerOptions) {
    this.opts = {
      neck: options?.neck ?? { maxYaw: 0.35, maxPitch: 0.25, strength: 0.12 },
      head: options?.head ?? { maxYaw: 0.55, maxPitch: 0.35, strength: 0.12 },
      eyes: options?.eyes ?? { maxYaw: 0.45, maxPitch: 0.30, strength: 0.25 },
      forwardAxis: options?.forwardAxis ?? "+Z",
    };
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

      // common names across rigs
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

    this.headRest = this.head ? this.head.quaternion.clone() : null;
    this.neckRest = this.neck ? this.neck.quaternion.clone() : null;
    this.leftEyeRest = this.leftEye ? this.leftEye.quaternion.clone() : null;
    this.rightEyeRest = this.rightEye ? this.rightEye.quaternion.clone() : null;

    // Helpful log while wiring up
    // eslint-disable-next-line no-console
    //console.log("Focus bones:", {
    //  neck: this.neck?.name,
    //  head: this.head?.name,
    //  leftEye: this.leftEye?.name,
    //  rightEye: this.rightEye?.name,
    //});
  }

  update(_delta: number, worldTarget: Vector3) {
    if (this.neck && this.neckRest) {
      this.aimBone(this.neck, this.neckRest, worldTarget, this.opts.neck);
    }
    if (this.head && this.headRest) {
      this.aimBone(this.head, this.headRest, worldTarget, this.opts.head);
    }

    // Eyes last so they can add detail on top
    if (this.leftEye && this.leftEyeRest) {
      this.aimBone(this.leftEye, this.leftEyeRest, worldTarget, this.opts.eyes);
    }
    if (this.rightEye && this.rightEyeRest) {
      this.aimBone(this.rightEye, this.rightEyeRest, worldTarget, this.opts.eyes);
    }
  }

  private aimBone(bone: Bone, restQ: Quaternion, worldTarget: Vector3, opts: AimOpts) {

    const DOWN_BIAS = 0.5; // ~15 degrees downward

    const parent = bone.parent as Object3D | null;
    if (!parent) return;

    bone.getWorldPosition(this.tmpBoneWorld);

    // dirWorld = target - bonePos
    this.tmpDirWorld.copy(worldTarget).sub(this.tmpBoneWorld).normalize();

    // Convert world direction to parent-local direction by removing parent world rotation
    parent.getWorldQuaternion(this.tmpParentWorldQ);
    this.tmpInvParentWorldQ.copy(this.tmpParentWorldQ).invert();

    const dirLocal = this.tmpDirWorld.clone().applyQuaternion(this.tmpInvParentWorldQ);

    // Convert direction to yaw/pitch assuming forward is +Z (typical glTF)
    // If forward axis is -Z, flip Z.
    const z = this.opts.forwardAxis === "+Z" ? dirLocal.z : -dirLocal.z;

    const yaw = Math.atan2(dirLocal.x, z);
    const pitch = Math.atan2(-dirLocal.y, Math.sqrt(dirLocal.x * dirLocal.x + z * z)) + DOWN_BIAS;

    const cyaw = clamp(yaw, -opts.maxYaw, opts.maxYaw);
    const cpitch = clamp(pitch, -opts.maxPitch, opts.maxPitch);

    this.tmpEuler.set(cpitch, cyaw, 0, "YXZ");
    this.tmpOffsetQ.setFromEuler(this.tmpEuler);

    this.tmpTargetQ.copy(restQ).multiply(this.tmpOffsetQ);

    bone.quaternion.slerp(this.tmpTargetQ, opts.strength);
  }
}
