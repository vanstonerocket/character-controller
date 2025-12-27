//CharacterModel.tsx

import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRapier } from "@react-three/rapier";
import { Group, Vector3 } from "three";
import type { AnimationAction } from "three";

import { interactionGroups } from "@react-three/rapier";

import { FaceManager } from "../utils/FaceManager";
import { useMaximoClips } from "../hooks/useMaximoClips";
import { useFootLockingIK } from "../hooks/useFootLockingIK";

type CharacterModelProps = {
  isMoving: boolean;
  isSprinting: boolean;
  isGrounded: boolean;
  avatarUrl?: string;
  rigidBody?: React.RefObject<any>;
} & JSX.IntrinsicElements["group"];

const DEFAULT_RPM_MODEL_URL =
  "https://models.readyplayer.me/6851995def31fd3e1a8f1fdb.glb";

const RPM_QUERY_ARGS = {
  morphTargets: "ARKit,OculusVisemes",
} as const;

function buildAvatarUrl(baseUrl: string): string {
  const [path, queryString] = baseUrl.split("?");
  const params = new URLSearchParams(queryString ?? "");
  for (const [key, value] of Object.entries(RPM_QUERY_ARGS)) params.set(key, value);
  const finalQuery = params.toString();
  return finalQuery ? `${path}?${finalQuery}` : path;
}

function resolveAction(
  actions: Record<string, AnimationAction | undefined>,
  keywords: string[]
): { name: string; action: AnimationAction } | null {
  for (const [name, action] of Object.entries(actions)) {
    if (!action) continue;
    const lower = name.toLowerCase();
    if (keywords.some((k) => lower.includes(k))) return { name, action };
  }
  return null;
}

export function CharacterModel({
  isMoving,
  isSprinting,
  isGrounded,
  avatarUrl,
  rigidBody,
  ...props
}: CharacterModelProps) {
  const group = useRef<Group>(null);

  const [current, setCurrent] = useState<{
    name: string;
    action: AnimationAction;
  } | null>(null);

  const currentRef = useRef<{
    name: string;
    action: AnimationAction;
  } | null>(null);

  const faceRef = useRef(
    new FaceManager({
      blink: { minInterval: 2.5, maxInterval: 6.0, speed: 12, intensity: 1.0 },
      focus: {
        neck: { maxYaw: 0.3, maxPitch: 0.2, strength: 1.0 },
        head: { maxYaw: 0.55, maxPitch: 0.35, strength: 1.0 },
        eyes: { maxYaw: 0.45, maxPitch: 0.3, strength: 0.25 },
      },
    })
  );

  const lookTarget = useRef(new Vector3());

  const resolvedAvatarUrl = useMemo(() => {
    const base = avatarUrl?.trim() ? avatarUrl.trim() : DEFAULT_RPM_MODEL_URL;
    return buildAvatarUrl(base);
  }, [avatarUrl]);

  const avatar = useGLTF(resolvedAvatarUrl, true);

  const { rapier, world } = useRapier();


  // FOOT LOCKING DOES NOT CURRENTLY WORK. REASONS ARE UNCLEAR AS TO WHY.
  // Foot locking hook
  //useFootLockingIK(avatar.scene, isGrounded, rapier, world, {
  //  debugLog: true,
  //  rayUp: 0.8,
  //  rayLen: 2.0,

  //  raycastGroups: 0x00010004, // floor collider collisionGroups
  //  excludeRigidBody: rigidBody?.current ?? null,
  //});


  const { rawClips, mappedClips } = useMaximoClips(avatar.scene);
  const { actions } = useAnimations(mappedClips, avatar.scene);

  useEffect(() => {
    if (!actions) return;
    Object.values(actions).forEach((a) => a?.stop());
    currentRef.current = null;
    setCurrent(null);
  }, [resolvedAvatarUrl, actions]);

  useEffect(() => {
    avatar.scene.traverse((child: any) => {
      if ("material" in child) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [avatar.scene]);

  useEffect(() => {
    faceRef.current.attachToAvatar(avatar.scene);
  }, [avatar.scene]);

  useFrame((state, delta) => {
    lookTarget.current.copy(state.camera.position);
    lookTarget.current.y += 0.1;
    faceRef.current.update(delta, lookTarget.current);
  }, 1);

  const prevGrounded = useRef<boolean>(isGrounded);
  useEffect(() => {
    if (prevGrounded.current === false && isGrounded === true) {
      faceRef.current.onLand();
    }
    prevGrounded.current = isGrounded;
  }, [isGrounded]);

  useEffect(() => {
    if (!actions || Object.keys(actions).length === 0) return;

    const next =
      !isGrounded
        ? resolveAction(actions as any, ["fall", "falling"])
        : !isMoving
          ? resolveAction(actions as any, ["idle"])
          : isSprinting
            ? resolveAction(actions as any, ["run", "running"])
            : resolveAction(actions as any, ["walk", "walking"]);

    if (!next) return;

    const cur = currentRef.current;

    if (cur && cur.name === next.name) {
      next.action.timeScale = isSprinting ? 1.25 : 1;
      if (!next.action.isRunning()) next.action.play();
      return;
    }

    next.action.reset();
    next.action.timeScale = isSprinting ? 1.25 : 1;
    next.action.play();

    if (cur?.action) cur.action.crossFadeTo(next.action, 0.15, true);
    else next.action.fadeIn(0.15);

    currentRef.current = next;
    setCurrent(next);
  }, [actions, isMoving, isSprinting, isGrounded]);

  return (
    <group ref={group} {...props}>
      <primitive object={avatar.scene} />
    </group>
  );
}
