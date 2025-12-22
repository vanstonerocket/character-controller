import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Vector3 } from "three";
import type { AnimationAction, Bone } from "three";

type CharacterModelProps = {
  isMoving: boolean;
  isSprinting: boolean;
  isGrounded: boolean;
} & JSX.IntrinsicElements["group"];

const RPM_URL = "https://models.readyplayer.me/6851995def31fd3e1a8f1fdb.glb";

/**
 * NOTE:
 * These animation files are TEMPORARY PLACEHOLDERS.
 * They currently include root motion (forward translation baked into the clip).
 *
 * Until we replace them with proper in-place animations,
 * we explicitly cancel root motion at runtime (see below).
 *
 * When in-place animations are available, the root-motion
 * cancellation code should be REMOVED.
 */
const IDLE_ANIM_URL = "/animation/F_Standing_Idle_001.glb";
const WALK_ANIM_URL = "/animation/F_Walk_002.glb";
const RUN_ANIM_URL = "/animation/F_Run_001.glb";
const FALL_ANIM_URL = "/animation/F_Falling_Idle_000.glb";

/**
 * Resolve an AnimationAction dynamically by keyword matching.
 * This avoids hard-coding clip names and makes the system resilient
 * to renamed or swapped animation assets.
 */
function resolveAction(
  actions: Record<string, AnimationAction | undefined>,
  keywords: string[]
): { name: string; action: AnimationAction } | null {
  for (const [name, action] of Object.entries(actions)) {
    if (!action) continue;
    const lower = name.toLowerCase();
    if (keywords.some((k) => lower.includes(k))) {
      return { name, action };
    }
  }
  return null;
}

export function CharacterModel({
  isMoving,
  isSprinting,
  isGrounded,
  ...props
}: CharacterModelProps) {
  const group = useRef<Group>(null);

  /**
   * Track the currently playing animation ACTION,
   * not a string name. This allows robust blending
   * even when clip names change.
   */
  const [current, setCurrent] = useState<{
    name: string;
    action: AnimationAction;
  } | null>(null);

  /**
   * Root motion suppression
   *
   * These refs store:
   * - the root bone of the avatar skeleton
   * - its original position (used as a baseline)
   *
   * This is a TEMPORARY runtime fix to cancel
   * forward translation coming from placeholder animations.
   */
  const rootBoneRef = useRef<Bone | null>(null);
  const rootBasePosRef = useRef<Vector3 | null>(null);

  // Load avatar mesh (no animations expected here)
  const avatar = useGLTF(RPM_URL, true);

  // Load placeholder animation clips as separate assets
  const idleGLB = useGLTF(IDLE_ANIM_URL, true);
  const walkGLB = useGLTF(WALK_ANIM_URL, true);
  const runGLB = useGLTF(RUN_ANIM_URL, true);
  const fallGLB = useGLTF(FALL_ANIM_URL, true);

  /**
   * Combine animation clips from all sources.
   * These clips are bound to the avatar skeleton
   * via useAnimations below.
   */
  const animations = useMemo(
    () => [
      ...(idleGLB.animations ?? []),
      ...(walkGLB.animations ?? []),
      ...(runGLB.animations ?? []),
      ...(fallGLB.animations ?? []),
    ],
    [idleGLB.animations, walkGLB.animations, runGLB.animations, fallGLB.animations]
  );

  const { actions } = useAnimations(animations, group);

  // Enable shadows on avatar meshes
  useEffect(() => {
    avatar.scene.traverse((child: any) => {
      if ("material" in child) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [avatar.scene]);

  /**
   * Locate the root bone once after the avatar loads.
   * This is usually the hips or first bone in the skeleton.
   *
   * We cache its initial position so we can restore it
   * every frame and cancel root motion.
   */
  useEffect(() => {
    let found: Bone | null = null;

    avatar.scene.traverse((obj: any) => {
      if (found) return;
      if (obj.isSkinnedMesh && obj.skeleton?.bones?.length) {
        found = obj.skeleton.bones[0];
      }
    });

    rootBoneRef.current = found;
    rootBasePosRef.current = found ? found.position.clone() : null;

    if (found) {
      console.log("Root bone locked (temporary fix):", found.name);
    }
  }, [avatar.scene]);

  /**
   * TEMPORARY ROOT MOTION SUPPRESSION
   *
   * Placeholder run animations include forward translation.
   * Physics already controls world position, so this causes
   * snapping and jitter unless neutralized.
   *
   * This block forces the root bone to stay at its
   * original X/Z position every frame.
   *
   * REMOVE THIS when using proper in-place animations.
   */
  useFrame(() => {
    const root = rootBoneRef.current;
    const base = rootBasePosRef.current;
    if (!root || !base) return;

    root.position.x = base.x;
    root.position.z = base.z;
  });

  /**
   * Animation state selection and blending.
   * Movement logic remains purely physics-driven.
   */
  useEffect(() => {
    const next =
      !isGrounded
        ? resolveAction(actions as any, ["fall", "falling"])
        : !isMoving
          ? resolveAction(actions as any, ["idle"])
          : isSprinting
            ? resolveAction(actions as any, ["run", "running"])
            : resolveAction(actions as any, ["walk", "walking"]);

    if (!next) return;

    if (current && current.name === next.name) {
      if (!next.action.isRunning()) next.action.play();
      return;
    }

    next.action.reset().play();
    next.action.timeScale = isSprinting ? 1.25 : 1;

    if (current?.action) {
      current.action.crossFadeTo(next.action, 0.15, true);
    }

    setCurrent(next);
  }, [actions, isMoving, isSprinting, isGrounded, current]);

  return (
    <group ref={group} {...props}>
      <primitive object={avatar.scene} />
    </group>
  );
}
