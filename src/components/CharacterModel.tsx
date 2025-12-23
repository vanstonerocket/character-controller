import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations, useFBX } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimationClip, Group, Vector3 } from "three";
import type {
  AnimationAction,
  KeyframeTrack,
  Object3D,
  SkinnedMesh,
  Bone,
} from "three";

import { FaceManager } from "../utils/FaceManager";

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

function removeHipsPositionTracks(clip: AnimationClip): AnimationClip {
  const c = clip.clone();
  c.tracks = c.tracks.filter((t) => {
    if (!t.name.endsWith(".position")) return true;
    const node = t.name.split(".")[0]; // after renaming this will be "Hips"
    return node !== "Hips";
  });
  return c;
}

// Mixamo in-place FBX animations
const IDLE_ANIM_URL = "/animation/Idle.fbx";
const WALK_ANIM_URL = "/animation/Female_Walk.fbx";
const RUN_ANIM_URL = "/animation/Fast_Run.fbx";
const FALL_ANIM_URL = "/animation/Falling_Idle.fbx";

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

/**
 * Helper: take the first clip from an FBX and give it a stable name.
 * Mixamo FBX often calls every clip "mixamo.com", so this is important
 * for resolveAction keyword matching later.
 */
function nameFirstClip(fbx: any, name: string): AnimationClip | null {
  const clip = fbx?.animations?.[0] ?? null;
  if (!clip) return null;
  const c = clip.clone();
  c.name = name;
  return c;
}

/**
 * Extract bone names from the avatar skeleton(s)
 */
function getAvatarBoneNames(root: Object3D): string[] {
  const names = new Set<string>();
  root.traverse((obj: any) => {
    const skinned = obj as SkinnedMesh;
    if (!skinned.isSkinnedMesh) return;
    const bones: Bone[] | undefined = skinned.skeleton?.bones;
    if (!bones) return;
    for (const b of bones) names.add(b.name);
  });
  return Array.from(names).sort();
}

/**
 * Track names look like:
 * "mixamorig1Hips.position"
 * "Armature|mixamorig1Hips.quaternion"
 * We want the node name only ("mixamorig1Hips")
 */
function getTrackNodeName(trackName: string): string {
  const beforeDot = trackName.split(".")[0] ?? "";
  const lastPath = beforeDot.split("|").pop() ?? "";
  return lastPath;
}

function getClipNodeNames(clip: AnimationClip): string[] {
  const names = new Set<string>();
  for (const t of clip.tracks) {
    const node = getTrackNodeName(t.name);
    if (node) names.add(node);
  }
  return Array.from(names).sort();
}

type BoneNameMap = Record<string, string>;

/**
 * Rename clip tracks to match the avatar skeleton.
 * This does not retarget rotations, it only renames track bindings.
 */
function renameClipTracks(clip: AnimationClip, map: BoneNameMap): AnimationClip {
  const newTracks = clip.tracks.map((t) => {
    const track = t as KeyframeTrack;

    const dotIndex = track.name.indexOf(".");
    const suffix = dotIndex >= 0 ? track.name.slice(dotIndex) : "";
    const node = getTrackNodeName(track.name);

    const mapped = map[node] ?? node;
    const cloned = track.clone();
    cloned.name = `${mapped}${suffix}`;
    return cloned;
  });

  const renamed = clip.clone();
  renamed.tracks = newTracks;
  return renamed;
}

/**
 * Validate whether a clip's node names match the avatar bone names.
 */
function validateClipAgainstAvatar(avatarBoneNames: string[], clip: AnimationClip) {
  const avatarSet = new Set(avatarBoneNames);

  const requiredNodes = new Set<string>();
  for (const t of clip.tracks) {
    const node = getTrackNodeName(t.name);
    if (node) requiredNodes.add(node);
  }

  const matched: string[] = [];
  const missing: string[] = [];

  for (const n of Array.from(requiredNodes).sort()) {
    if (avatarSet.has(n)) matched.push(n);
    else missing.push(n);
  }

  return {
    matched,
    missing,
    matchedCount: matched.length,
    missingCount: missing.length,
    totalNodes: requiredNodes.size,
  };
}

/**
 * Auto-map Mixamo bone names to RPM bone names by stripping the mixamo prefix.
 * Handles both "mixamorig" and "mixamorig1" prefixes.
 */
function buildAutoBoneMap(avatarBoneNames: string[], clipNodeNames: string[]): BoneNameMap {
  const avatarSet = new Set(avatarBoneNames);
  const map: BoneNameMap = {};

  const stripMixamo = (name: string) =>
    name.replace(/^mixamorig1/i, "").replace(/^mixamorig/i, "");

  for (const src of clipNodeNames) {
    if (avatarSet.has(src)) continue;
    const stripped = stripMixamo(src);
    if (stripped !== src && avatarSet.has(stripped)) {
      map[src] = stripped;
    }
  }

  return map;
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

  // FBX animations
  const idleFbx = useFBX(IDLE_ANIM_URL);
  const walkFbx = useFBX(WALK_ANIM_URL);
  const runFbx = useFBX(RUN_ANIM_URL);
  const fallFbx = useFBX(FALL_ANIM_URL);

  // Raw clips from FBX (named!)
  const rawClips = useMemo<AnimationClip[]>(
    () => {
      const clips: AnimationClip[] = [];

      const idle = nameFirstClip(idleFbx, "idle");
      const walk = nameFirstClip(walkFbx, "walk");
      const run = nameFirstClip(runFbx, "run");
      const fall = nameFirstClip(fallFbx, "fall");

      if (idle) clips.push(idle);
      if (walk) clips.push(walk);
      if (run) clips.push(run);
      if (fall) clips.push(fall);

      return clips;
    },
    [idleFbx, walkFbx, runFbx, fallFbx]
  );

  // Rename (map) track bindings so FBX tracks match RPM bones
  const mappedClips = useMemo(() => {
    const avatarBones = getAvatarBoneNames(avatar.scene);

    const allNodes = Array.from(new Set(rawClips.flatMap((c) => getClipNodeNames(c)))).sort();
    const autoMap = buildAutoBoneMap(avatarBones, allNodes);

    // Optional manual overrides, if you ever need them
    const manualMap: BoneNameMap = {};

    const finalMap: BoneNameMap = { ...autoMap, ...manualMap };

    return rawClips.map((clip) =>
      removeHipsPositionTracks(renameClipTracks(clip, finalMap))
    );
  }, [avatar.scene, rawClips]);

  // Create actions, but do not play anything yet
  const { actions } = useAnimations(mappedClips, group);

  // Debug print: validate mapping and show action names
  useEffect(() => {
    const avatarBones = getAvatarBoneNames(avatar.scene);
    //console.log("AVATAR bones:", avatarBones);

    //rawClips.forEach((clip) => {
    //  console.log(`RAW FBX clip: ${clip.name || "(unnamed)"}`);
    //  console.log("RAW FBX nodes:", getClipNodeNames(clip));
    //});

    mappedClips.forEach((clip) => {
      const report = validateClipAgainstAvatar(avatarBones, clip);
      console.log(`MAPPED clip: ${clip.name || "(unnamed)"}`);
      console.log("MAPPING report:", report);
      if (report.missingCount > 0) console.warn("Missing nodes:", report.missing);
      else console.log("Mapping looks complete for this clip.");
    });

    console.log("Actions:", Object.keys(actions));
  }, [avatar.scene, rawClips, mappedClips, actions]);

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
