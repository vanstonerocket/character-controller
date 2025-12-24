import { useMemo } from "react";
import { useFBX } from "@react-three/drei";
import type { AnimationClip, Object3D, Bone, KeyframeTrack, SkinnedMesh } from "three";

/** Mixamo in-place FBX animations */
const IDLE_ANIM_URL = "/animation/Idle.fbx";
const WALK_ANIM_URL = "/animation/Female_Walk.fbx";
const RUN_ANIM_URL = "/animation/Fast_Run.fbx";
const FALL_ANIM_URL = "/animation/Falling_Idle.fbx";

type BoneNameMap = Record<string, string>;

/**
 * Helper: take the first clip from an FBX and give it a stable name.
 * Mixamo FBX often calls every clip "mixamo.com".
 */
function nameFirstClip(fbx: any, name: string): AnimationClip | null {
    const clip = fbx?.animations?.[0] ?? null;
    if (!clip) return null;
    const c = clip.clone();
    c.name = name;
    return c;
}

function removeHipsPositionTracks(clip: AnimationClip): AnimationClip {
    const c = clip.clone();
    c.tracks = c.tracks.filter((t) => {
        if (!t.name.endsWith(".position")) return true;
        const node = t.name.split(".")[0];
        return node !== "Hips";
    });
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

export type UseMaximoClipsResult = {
    /** Raw named clips straight from FBX */
    rawClips: AnimationClip[];
    /** Clips with track bindings renamed to match the avatar rig */
    mappedClips: AnimationClip[];
};

export function useMaximoClips(avatarRoot?: Object3D | null): UseMaximoClipsResult {
    // Load FBX animations
    const idleFbx = useFBX(IDLE_ANIM_URL);
    const walkFbx = useFBX(WALK_ANIM_URL);
    const runFbx = useFBX(RUN_ANIM_URL);
    const fallFbx = useFBX(FALL_ANIM_URL);

    // Raw clips (named)
    const rawClips = useMemo<AnimationClip[]>(() => {
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
    }, [idleFbx, walkFbx, runFbx, fallFbx]);

    // Mapped clips (renamed bindings)
    const mappedClips = useMemo<AnimationClip[]>(() => {
        if (!avatarRoot) return rawClips;

        const avatarBones = getAvatarBoneNames(avatarRoot);
        const allNodes = Array.from(new Set(rawClips.flatMap((c) => getClipNodeNames(c)))).sort();
        const autoMap = buildAutoBoneMap(avatarBones, allNodes);

        // Optional manual overrides
        const manualMap: BoneNameMap = {};
        const finalMap: BoneNameMap = { ...autoMap, ...manualMap };

        return rawClips.map((clip) => removeHipsPositionTracks(renameClipTracks(clip, finalMap)));
    }, [avatarRoot, rawClips]);

    return { rawClips, mappedClips };
}
