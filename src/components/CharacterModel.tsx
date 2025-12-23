import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Vector3 } from "three";
import type { AnimationAction, Bone } from "three";

import { FaceManager } from "../utils/FaceManager";

type CharacterModelProps = {
  isMoving: boolean;
  isSprinting: boolean;
  isGrounded: boolean;

  /**
   * Optional Ready Player Me GLB URL.
   * If omitted, falls back to DEFAULT_RPM_MODEL_URL.
   */
  avatarUrl?: string;
} & JSX.IntrinsicElements["group"];

const DEFAULT_RPM_MODEL_URL =
  "https://models.readyplayer.me/6851995def31fd3e1a8f1fdb.glb";

// Split args out so they can be appended later.
const RPM_QUERY_ARGS = {
  morphTargets: "ARKit,OculusVisemes",
} as const;

function buildAvatarUrl(baseUrl: string): string {
  // Preserve any existing query params on the provided URL, then add ours.
  const [path, queryString] = baseUrl.split("?");
  const params = new URLSearchParams(queryString ?? "");

  for (const [key, value] of Object.entries(RPM_QUERY_ARGS)) {
    params.set(key, value);
  }

  const finalQuery = params.toString();
  return finalQuery ? `${path}?${finalQuery}` : path;
}

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
  avatarUrl,
  ...props
}: CharacterModelProps) {
  const group = useRef<Group>(null);

  const [current, setCurrent] = useState<{
    name: string;
    action: AnimationAction;
  } | null>(null);

  // TEMP root motion suppression
  const rootBoneRef = useRef<Bone | null>(null);
  const rootBasePosRef = useRef<Vector3 | null>(null);

  // Face manager (blink + focus) lives per character instance
  const faceRef = useRef(
    new FaceManager({
      blink: { minInterval: 2.5, maxInterval: 6.0, speed: 12, intensity: 1.0 },
      focus: {
        neck: { maxYaw: 0.30, maxPitch: 0.20, strength: 1.0 },
        head: { maxYaw: 0.55, maxPitch: 0.35, strength: 1.0 },
        eyes: { maxYaw: 0.45, maxPitch: 0.30, strength: 0.25 },
      },
    })
  );
  const lookTarget = useRef(new Vector3());

  // Build the final URL from either the provided URL or the default.
  const resolvedAvatarUrl = useMemo(() => {
    const base = (avatarUrl?.trim() ? avatarUrl.trim() : DEFAULT_RPM_MODEL_URL);
    return buildAvatarUrl(base);
  }, [avatarUrl]);

  // Load avatar (keyed by resolvedAvatarUrl so it reloads when URL changes)
  const avatar = useGLTF(resolvedAvatarUrl, true);

  // Load animation clips
  const idleGLB = useGLTF(IDLE_ANIM_URL, true);
  const walkGLB = useGLTF(WALK_ANIM_URL, true);
  const runGLB = useGLTF(RUN_ANIM_URL, true);
  const fallGLB = useGLTF(FALL_ANIM_URL, true);

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

  // Enable shadows
  useEffect(() => {
    avatar.scene.traverse((child: any) => {
      if ("material" in child) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [avatar.scene]);

  // Attach face manager to avatar (blink targets + bones)
  useEffect(() => {
    faceRef.current.attachToAvatar(avatar.scene);
  }, [avatar.scene]);

  // Find hips/root bone for temporary root-motion suppression
  useEffect(() => {
    let found: Bone | null = null;

    avatar.scene.traverse((obj: any) => {
      if (found) return;
      if (!obj.isSkinnedMesh || !obj.skeleton?.bones?.length) return;

      const byName =
        obj.skeleton.getBoneByName?.("Hips") ||
        obj.skeleton.getBoneByName?.("mixamorigHips") ||
        obj.skeleton.bones.find((b: any) => b.name?.toLowerCase().includes("hips")) ||
        null;

      found = byName ?? obj.skeleton.bones[0];
    });

    rootBoneRef.current = found;
    rootBasePosRef.current = found ? found.position.clone() : null;

    console.log("Root bone locked (temporary fix):", found?.name);
  }, [avatar.scene]);

  // Per-frame updates: cancel root motion + face updates (blink + look)
  useFrame((state, delta) => {
    // TEMP root motion suppression (remove later when animations are in-place)
    const root = rootBoneRef.current;
    const base = rootBasePosRef.current;
    if (root && base) {
      root.position.x = base.x;
      root.position.z = base.z;
    }

    // Look at the camera (slight upward bias for eye contact)
    lookTarget.current.copy(state.camera.position);
    lookTarget.current.y += 0.1;

    // Apply blink + look AFTER animations have posed the skeleton this frame
    faceRef.current.update(delta, lookTarget.current);
  }, 1);

  // Optional landing blink
  const prevGrounded = useRef<boolean>(isGrounded);
  useEffect(() => {
    if (prevGrounded.current === false && isGrounded === true) {
      faceRef.current.onLand();
    }
    prevGrounded.current = isGrounded;
  }, [isGrounded]);

  // Animation selection + blending
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
      next.action.timeScale = isSprinting ? 1.25 : 1;
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
