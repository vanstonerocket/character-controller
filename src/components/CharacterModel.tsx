// CharacterModel.tsx

import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRapier } from "@react-three/rapier";
import { Group, Vector3, MathUtils } from "three";
import type { AnimationAction } from "three";
import * as THREE from "three";

import { FaceManager } from "../utils/FaceManager";
import { useMaximoClips } from "../hooks/useMaximoClips";
import { useAudioLipSync } from "../hooks/useAudioLipSync";

type CharacterModelProps = {
  isMoving: boolean;
  isSprinting: boolean;
  isGrounded: boolean;
  avatarUrl?: string;
  rigidBody?: React.RefObject<any>;
  ttsAudioRef?: React.RefObject<HTMLAudioElement>;
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

// Prefer head/face meshes, avoid eyes
function findBestFaceMorphMesh(root: THREE.Object3D): THREE.Mesh | null {
  const candidates: THREE.Mesh[] = [];

  root.traverse((obj: any) => {
    const isMesh = obj && (obj.isMesh || obj.isSkinnedMesh);
    if (!isMesh) return;
    if (!obj.morphTargetDictionary || !obj.morphTargetInfluences) return;
    candidates.push(obj as THREE.Mesh);
  });

  if (candidates.length === 0) return null;

  const score = (m: THREE.Mesh) => {
    const name = ((m as any).name ?? "").toLowerCase();
    const dict = (m as any).morphTargetDictionary as Record<string, number> | undefined;
    const keys = dict ? Object.keys(dict) : [];

    let s = 0;

    if (name.includes("head")) s += 100;
    if (name.includes("face")) s += 80;
    if (name.includes("wolf3d")) s += 30;

    if (name.includes("eye")) s -= 100;
    if (name.includes("teeth")) s -= 60;
    if (name.includes("tongue")) s -= 40;

    if (keys.includes("jawOpen") || keys.includes("JawOpen")) s += 30;
    if (keys.includes("mouthClose") || keys.includes("MouthClose")) s += 15;

    return s;
  };

  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0];
}

function morphIndex(
  dict: Record<string, number> | undefined,
  candidates: string[]
): number | null {
  if (!dict) return null;
  for (const key of candidates) {
    if (key in dict) return dict[key];
  }
  return null;
}

export function CharacterModel({
  isMoving,
  isSprinting,
  isGrounded,
  avatarUrl,
  rigidBody,
  ttsAudioRef,
  ...props
}: CharacterModelProps) {
  const group = useRef<Group>(null);
  const debugEveryRef = useRef(0); // ✅ inside component

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

  // ---- Lip sync setup ----
  const faceMeshRef = useRef<THREE.Mesh | null>(null);
  const jawIdxRef = useRef<number | null>(null);
  const closeIdxRef = useRef<number | null>(null);
  const funnelIdxRef = useRef<number | null>(null);

  useEffect(() => {
    const mesh = findBestFaceMorphMesh(avatar.scene);
    faceMeshRef.current = mesh;

    jawIdxRef.current = null;
    closeIdxRef.current = null;
    funnelIdxRef.current = null;

    if (!mesh) {
      console.warn("LipSync: no morph-target mesh found on avatar");
      return;
    }

    const dict = (mesh as any).morphTargetDictionary as Record<string, number> | undefined;

    // Your logs show lower-case keys like jawOpen/mouthClose/mouthFunnel
    jawIdxRef.current = morphIndex(dict, ["jawOpen", "JawOpen"]);
    closeIdxRef.current = morphIndex(dict, ["mouthClose", "MouthClose"]);
    funnelIdxRef.current = morphIndex(dict, ["mouthFunnel", "MouthFunnel", "mouthPucker", "MouthPucker"]);

    // console.log("LipSync mesh:", (mesh as any).name, Object.keys(dict ?? {}));
  }, [avatar.scene]);

  const lip = useAudioLipSync(ttsAudioRef ?? ({ current: null } as any));




  useFrame(() => {
    const audioEl = ttsAudioRef?.current;
    const mesh = faceMeshRef.current as any;
    if (!audioEl || !mesh?.morphTargetInfluences) return;

    const isPlaying = !audioEl.paused && !audioEl.ended;

    const jawIdx = jawIdxRef.current;
    const closeIdx = closeIdxRef.current;
    const funnelIdx = funnelIdxRef.current;

    if (!isPlaying) {
      if (jawIdx !== null) mesh.morphTargetInfluences[jawIdx] *= 0.85;
      if (closeIdx !== null) mesh.morphTargetInfluences[closeIdx] *= 0.85;
      if (funnelIdx !== null) mesh.morphTargetInfluences[funnelIdx] *= 0.85;
      return;
    }

    const s = lip.sample();

    if (jawIdx !== null) {
      mesh.morphTargetInfluences[jawIdx] = MathUtils.clamp(s.jaw, 0, 1);
    }

    if (closeIdx !== null) {
      mesh.morphTargetInfluences[closeIdx] = MathUtils.clamp((1 - s.jaw) * 0.6, 0, 1);
    }

    if (funnelIdx !== null) {
      mesh.morphTargetInfluences[funnelIdx] = MathUtils.clamp(s.lips * 0.6, 0, 1);
    }

    //debugEveryRef.current++;
    //if (debugEveryRef.current % 60 === 0) {
    // console.log("[LipSync]", {
    //    paused: audioEl.paused,
    //    ended: audioEl.ended,
    //    time: audioEl.currentTime,
    //    sample: s
    //  });
    //}
  }, 2);

  return (
    <group ref={group} {...props}>
      <primitive object={avatar.scene} />
    </group>
  );
}
