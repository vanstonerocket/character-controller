// src/hooks/useMixamoClips.ts
import { useMemo, useEffect } from "react";
import { useAnimations, useFBX } from "@react-three/drei";
import type { AnimationClip, Object3D, SkinnedMesh, Bone } from "three";
import type { AnimationAction, KeyframeTrack } from "three";

type BoneNameMap = Record<string, string>;

type MixamoAnimUrls = Partial<{
    idle: string;
    walk: string;
    run: string;
    fall: string;
}>;

type UseMixamoClipsOptions = {
    /** optional manual overrides if auto map misses something */
    manualMap?: BoneNameMap;

    /** optional debug logs for mapping validation */
    debug?: boolean;
};


function removeHipsPositionTracks(clip: AnimationClip, hipsBoneName = "Hips"): AnimationClip {
    const c = clip.clone();
    c.tracks = c.tracks.filter((t) => {
        if (!t.name.endsWith(".position")) return true;
        const node = t.name.split(".")[0];
        return node !== hipsBoneName;
    });
    return c;
}


/**
 * Take the first clip from an FBX and give it a stable name.
 * Mixamo FBX often calls every clip "mixamo.com".
 */
function nameFirstClip(fbx: any, name: string): AnimationClip | null {
    const clip = fbx?.animations?.[0] ?? null;
    if (!clip) return null;
    const c = clip.clone();
    c.name = name;
    return c;
}

/** Extract avatar bone names from any skinned meshes under root */
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
 * We want node name only ("mixamorig1Hips")
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
 * Auto-map Mixamo bone names to RPM bone names by stripping mixamo prefix.
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

/**
 * Rename clip track bindings to match the avatar skeleton.
 * IMPORTANT: this does not change any animation content, only the binding names.
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

const EMPTY_MAP: BoneNameMap = {};
export function useMixamoClips(
    avatarRoot: Object3D | undefined,
    target: React.RefObject<Object3D>,
    urls: MixamoAnimUrls,
    options: UseMixamoClipsOptions = {}
): {
    clips: AnimationClip[];
    actions: Record<string, AnimationAction | undefined>;
} {
    const manualMap = options.manualMap ?? EMPTY_MAP;
    const debug = options.debug ?? false;

    const idleFbx = useFBX(urls.idle ?? "/animation/Idle.fbx");
    const walkFbx = useFBX(urls.walk ?? "/animation/Female_Walk.fbx");
    const runFbx = useFBX(urls.run ?? "/animation/Fast_Run.fbx");
    const fallFbx = useFBX(urls.fall ?? "/animation/Falling_Idle.fbx");

    // Named clips (stable action names)
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

    // Map track bindings to avatar bones (no other changes)
    const mappedClips = useMemo<AnimationClip[]>(() => {
        if (!avatarRoot) return rawClips;

        const avatarBones = getAvatarBoneNames(avatarRoot);
        const allClipNodes = Array.from(
            new Set(rawClips.flatMap((c) => getClipNodeNames(c)))
        ).sort();

        const autoMap = buildAutoBoneMap(avatarBones, allClipNodes);
        const finalMap: BoneNameMap = { ...autoMap, ...manualMap };

        return rawClips.map((clip) => {
            const renamed = renameClipTracks(clip, finalMap);
            return removeHipsPositionTracks(renamed, "Hips");
        });
    }, [avatarRoot, rawClips, manualMap]);

    const { actions } = useAnimations(mappedClips, target);

    useEffect(() => {
        if (!debug || !avatarRoot) return;

        const avatarBones = getAvatarBoneNames(avatarRoot);

        mappedClips.forEach((clip) => {
            const report = validateClipAgainstAvatar(avatarBones, clip);
            // eslint-disable-next-line no-console
            console.log(`[useMixamoAnimations] clip=${clip.name}`, report);
            if (report.missingCount > 0) {
                // eslint-disable-next-line no-console
                console.warn(`[useMixamoAnimations] missing nodes for ${clip.name}:`, report.missing);
            }
        });

        // eslint-disable-next-line no-console
        console.log("[useMixamoAnimations] actions:", Object.keys(actions));
    }, [debug, avatarRoot, mappedClips, actions]);

    return { clips: mappedClips, actions };
}
