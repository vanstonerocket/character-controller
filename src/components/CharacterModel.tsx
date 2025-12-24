import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Group, Vector3 } from "three";
import type { AnimationAction } from "three";

import { FaceManager } from "../utils/FaceManager";
import { useMixamoClips } from "../hooks/useMaximoClips";

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

// Mixamo FBX animations
const IDLE_ANIM_URL = "/animation/Idle.fbx";
const WALK_ANIM_URL = "/animation/Female_Walk.fbx";
const RUN_ANIM_URL = "/animation/Fast_Run.fbx";
const FALL_ANIM_URL = "/animation/Falling_Idle.fbx";

const FADE = 0.15;

function pickNextAction(
  actions: Record<string, AnimationAction | undefined>,
  isMoving: boolean,
  isSprinting: boolean,
  isGrounded: boolean
): { name: string; action: AnimationAction } | null {
  const idle = actions.idle;
  const walk = actions.walk;
  const run = actions.run;
  const fall = actions.fall;

  if (!isGrounded && fall) return { name: "fall", action: fall };
  if (!isMoving && idle) return { name: "idle", action: idle };
  if (isMoving && isSprinting && run) return { name: "run", action: run };
  if (isMoving && walk) return { name: "walk", action: walk };

  const first = Object.entries(actions).find(([, a]) => a);
  return first ? { name: first[0], action: first[1]! } : null;
}

export function CharacterModel({
  isMoving,
  isSprinting,
  isGrounded,
  avatarUrl,
  ...props
}: CharacterModelProps) {
  const group = useRef<Group>(null);

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
  const faceAttached = useRef(false);

  const resolvedAvatarUrl = useMemo(() => {
    const base = avatarUrl?.trim() ? avatarUrl.trim() : DEFAULT_RPM_MODEL_URL;
    return buildAvatarUrl(base);
  }, [avatarUrl]);

  // Avatar GLB
  const avatar = useGLTF(resolvedAvatarUrl, true);

  // External hook handles FBX loading + naming + mapping to this avatar
  const { actions } = useMixamoClips(
    avatar.scene,
    group,
    {
      idle: IDLE_ANIM_URL,
      walk: WALK_ANIM_URL,
      run: RUN_ANIM_URL,
      fall: FALL_ANIM_URL,
    },
    { debug: true }
  );

  // Enable shadows
  useEffect(() => {
    avatar.scene.traverse((child: any) => {
      if ("material" in child) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [avatar.scene]);

  // Attach face manager as early as possible
  useLayoutEffect(() => {
    faceRef.current.attachToAvatar(avatar.scene);
    faceAttached.current = true;
  }, [avatar.scene]);

  // Drive animations from movement state (idle/walk/run/fall)
  const currentRef = useRef<{ name: string; action: AnimationAction } | null>(null);

  useEffect(() => {
    if (!group.current) return;

    const next = pickNextAction(actions, isMoving, isSprinting, isGrounded);
    if (!next) return;

    const prev = currentRef.current;

    if (prev?.name === next.name) {
      next.action.timeScale = next.name === "run" ? 1.15 : 1;
      if (!next.action.isRunning()) next.action.play();
      return;
    }

    Object.entries(actions).forEach(([name, action]) => {
      if (!action) return;
      if (name !== next.name) action.stop();
    });

    next.action.reset();
    next.action.fadeIn(FADE);
    next.action.play();

    if (prev?.action) {
      prev.action.crossFadeTo(next.action, FADE, true);
    }

    currentRef.current = next;
  }, [actions, isMoving, isSprinting, isGrounded]);

  // Per-frame: face update after everything else
  useFrame((state, delta) => {
    if (!faceAttached.current) return;

    lookTarget.current.copy(state.camera.position);
    lookTarget.current.y += 0.1;

    faceRef.current.update(delta, lookTarget.current);
  }, -10);

  useEffect(() => {
    console.log("Face attached:", faceAttached.current);
  }, [avatar.scene]);

  // Optional landing blink
  const prevGrounded = useRef<boolean>(isGrounded);
  useEffect(() => {
    if (prevGrounded.current === false && isGrounded === true) {
      faceRef.current.onLand();
    }
    prevGrounded.current = isGrounded;
  }, [isGrounded]);

  return (
    <group ref={group} {...props}>
      <primitive object={avatar.scene} />
    </group>
  );
}
