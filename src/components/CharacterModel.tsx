import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Vector3 } from "three";
import type { AnimationAction } from "three";

import { FaceManager } from "../utils/FaceManager";
import { useMaximoClips } from "../hooks/useMaximoClips";

type CharacterModelProps = {
  isMoving: boolean;
  isSprinting: boolean;
  isGrounded: boolean;
  avatarUrl?: string;
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
  ...props
}: CharacterModelProps) {
  const group = useRef<Group>(null);

  const [current, setCurrent] = useState<{
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

  // Avatar GLB
  const avatar = useGLTF(resolvedAvatarUrl, true);

  // Mixamo clips (loaded + mapped) via hook
  const { rawClips, mappedClips } = useMaximoClips(avatar.scene);

  // Create actions, but do not play anything yet
  const { actions } = useAnimations(mappedClips, group);

  // Debug print: action names
  useEffect(() => {
    console.log("Actions:", Object.keys(actions));
  }, [actions, rawClips, mappedClips]);

  // Enable shadows
  useEffect(() => {
    avatar.scene.traverse((child: any) => {
      if ("material" in child) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [avatar.scene]);

  useEffect(() => {
    const idle = actions.idle;
    if (!idle) return;

    // Stop others just in case
    Object.entries(actions).forEach(([name, action]) => {
      if (name !== "idle") action?.stop();
    });

    idle.reset().fadeIn(0.15).play();

    return () => {
      idle.fadeOut(0.1);
      idle.stop();
    };
  }, [actions]);

  // Attach face manager
  useEffect(() => {
    faceRef.current.attachToAvatar(avatar.scene);
  }, [avatar.scene]);

  // Per-frame: face update only
  useFrame((state, delta) => {
    lookTarget.current.copy(state.camera.position);
    lookTarget.current.y += 0.1;
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

  // If/when you want to re-enable playback later, you can uncomment this:
  //
  // useEffect(() => {
  //   const next =
  //     !isGrounded
  //       ? resolveAction(actions as any, ["fall", "falling"])
  //       : !isMoving
  //         ? resolveAction(actions as any, ["idle"])
  //         : isSprinting
  //           ? resolveAction(actions as any, ["run", "running"])
  //           : resolveAction(actions as any, ["walk", "walking"]);
  //
  //   if (!next) return;
  //
  //   if (current && current.name === next.name) {
  //     next.action.timeScale = isSprinting ? 1.25 : 1;
  //     if (!next.action.isRunning()) next.action.play();
  //     return;
  //   }
  //
  //   next.action.reset().play();
  //   next.action.timeScale = isSprinting ? 1.25 : 1;
  //
  //   if (current?.action) current.action.crossFadeTo(next.action, 0.15, true);
  //   setCurrent(next);
  // }, [actions, isMoving, isSprinting, isGrounded, current, isSprinting]);

  return (
    <group ref={group} {...props}>
      <primitive object={avatar.scene} />
    </group>
  );
}
