// hooks/useAvatarLipSync.ts

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MathUtils } from "three";
import * as THREE from "three";
import { useAudioLipSync } from "../hooks/useAudioLipSync";

type UseAvatarLipSyncArgs = {
    avatarScene: THREE.Object3D;
    ttsAudioRef?: React.RefObject<HTMLAudioElement>;
    resolvedAvatarUrl?: string;
    debug?: boolean;
};

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

export function useAvatarLipSync({
    avatarScene,
    ttsAudioRef,
    resolvedAvatarUrl,
    debug = false,
}: UseAvatarLipSyncArgs) {
    const faceMeshRef = useRef<THREE.Mesh | null>(null);
    const teethMeshRef = useRef<THREE.Mesh | null>(null);

    const jawIdxRef = useRef<number | null>(null);
    const closeIdxRef = useRef<number | null>(null);
    const funnelIdxRef = useRef<number | null>(null);

    const smileLIdxRef = useRef<number | null>(null);
    const smileRIdxRef = useRef<number | null>(null);
    const pressLIdxRef = useRef<number | null>(null);
    const pressRIdxRef = useRef<number | null>(null);

    const teethJawIdxRef = useRef<number | null>(null);
    const teethCloseIdxRef = useRef<number | null>(null);
    const teethFunnelIdxRef = useRef<number | null>(null);

    const teethSmileLIdxRef = useRef<number | null>(null);
    const teethSmileRIdxRef = useRef<number | null>(null);
    const teethPressLIdxRef = useRef<number | null>(null);
    const teethPressRIdxRef = useRef<number | null>(null);

    useEffect(() => {
        const faceMesh = findBestFaceMorphMesh(avatarScene);
        faceMeshRef.current = faceMesh;

        const teethMesh = avatarScene.getObjectByName("Wolf3D_Teeth") as THREE.Mesh | null;
        teethMeshRef.current = teethMesh;

        jawIdxRef.current = null;
        closeIdxRef.current = null;
        funnelIdxRef.current = null;

        smileLIdxRef.current = null;
        smileRIdxRef.current = null;
        pressLIdxRef.current = null;
        pressRIdxRef.current = null;

        teethJawIdxRef.current = null;
        teethCloseIdxRef.current = null;
        teethFunnelIdxRef.current = null;

        teethSmileLIdxRef.current = null;
        teethSmileRIdxRef.current = null;
        teethPressLIdxRef.current = null;
        teethPressRIdxRef.current = null;

        if (!faceMesh) {
            if (debug) console.warn("LipSync: no morph-target mesh found on avatar");
            return;
        }

        const faceDict = (faceMesh as any).morphTargetDictionary as Record<string, number> | undefined;

        jawIdxRef.current = morphIndex(faceDict, ["jawOpen", "JawOpen"]);
        closeIdxRef.current = morphIndex(faceDict, ["mouthClose", "MouthClose"]);
        funnelIdxRef.current = morphIndex(faceDict, ["mouthFunnel", "MouthFunnel", "mouthPucker", "MouthPucker"]);

        smileLIdxRef.current = morphIndex(faceDict, ["mouthSmileLeft", "MouthSmileLeft"]);
        smileRIdxRef.current = morphIndex(faceDict, ["mouthSmileRight", "MouthSmileRight"]);

        if (smileLIdxRef.current === null) {
            smileLIdxRef.current = morphIndex(faceDict, ["mouthStretchLeft", "MouthStretchLeft"]);
        }
        if (smileRIdxRef.current === null) {
            smileRIdxRef.current = morphIndex(faceDict, ["mouthStretchRight", "MouthStretchRight"]);
        }

        pressLIdxRef.current = morphIndex(faceDict, ["mouthPressLeft", "MouthPressLeft"]);
        pressRIdxRef.current = morphIndex(faceDict, ["mouthPressRight", "MouthPressRight"]);

        if (!teethMesh) {
            if (debug) console.warn("LipSync: Wolf3D_Teeth not found on avatar");
            return;
        }

        const teethDict = (teethMesh as any).morphTargetDictionary as Record<string, number> | undefined;

        teethJawIdxRef.current = morphIndex(teethDict, ["jawOpen", "JawOpen"]);
        teethCloseIdxRef.current = morphIndex(teethDict, ["mouthClose", "MouthClose"]);
        teethFunnelIdxRef.current = morphIndex(teethDict, ["mouthFunnel", "MouthFunnel", "mouthPucker", "MouthPucker"]);

        teethSmileLIdxRef.current = morphIndex(teethDict, ["mouthSmileLeft", "MouthSmileLeft"]);
        teethSmileRIdxRef.current = morphIndex(teethDict, ["mouthSmileRight", "MouthSmileRight"]);

        if (teethSmileLIdxRef.current === null) {
            teethSmileLIdxRef.current = morphIndex(teethDict, ["mouthStretchLeft", "MouthStretchLeft"]);
        }
        if (teethSmileRIdxRef.current === null) {
            teethSmileRIdxRef.current = morphIndex(teethDict, ["mouthStretchRight", "MouthStretchRight"]);
        }

        teethPressLIdxRef.current = morphIndex(teethDict, ["mouthPressLeft", "MouthPressLeft"]);
        teethPressRIdxRef.current = morphIndex(teethDict, ["mouthPressRight", "MouthPressRight"]);
    }, [avatarScene, debug]);

    const lip = useAudioLipSync(ttsAudioRef ?? ({ current: null } as any));

    useEffect(() => {
        if (!debug) return;

        console.log("[Avatar Debug] Node list for:", resolvedAvatarUrl ?? "(unknown url)");

        const rows: any[] = [];
        avatarScene.traverse((obj: any) => {
            rows.push({
                name: obj?.name || "(no name)",
                type: obj?.type,
                isSkinnedMesh: !!obj?.isSkinnedMesh,
                hasMorphTargets: !!obj?.morphTargetDictionary,
            });
        });

        console.table(rows);
    }, [avatarScene, resolvedAvatarUrl, debug]);

    useFrame(() => {
        const audioEl = ttsAudioRef?.current;
        const faceMesh = faceMeshRef.current as any;
        const teethMesh = teethMeshRef.current as any;

        if (!audioEl || !faceMesh?.morphTargetInfluences) return;

        const isPlaying = !audioEl.paused && !audioEl.ended;

        const jawIdx = jawIdxRef.current;
        const closeIdx = closeIdxRef.current;
        const funnelIdx = funnelIdxRef.current;

        const smileLIdx = smileLIdxRef.current;
        const smileRIdx = smileRIdxRef.current;
        const pressLIdx = pressLIdxRef.current;
        const pressRIdx = pressRIdxRef.current;

        const teethJawIdx = teethJawIdxRef.current;
        const teethCloseIdx = teethCloseIdxRef.current;
        const teethFunnelIdx = teethFunnelIdxRef.current;

        const teethSmileLIdx = teethSmileLIdxRef.current;
        const teethSmileRIdx = teethSmileRIdxRef.current;
        const teethPressLIdx = teethPressLIdxRef.current;
        const teethPressRIdx = teethPressRIdxRef.current;

        if (!isPlaying) {
            if (jawIdx !== null) faceMesh.morphTargetInfluences[jawIdx] *= 0.85;
            if (closeIdx !== null) faceMesh.morphTargetInfluences[closeIdx] *= 0.85;
            if (funnelIdx !== null) faceMesh.morphTargetInfluences[funnelIdx] *= 0.85;

            if (smileLIdx !== null) faceMesh.morphTargetInfluences[smileLIdx] *= 0.85;
            if (smileRIdx !== null) faceMesh.morphTargetInfluences[smileRIdx] *= 0.85;
            if (pressLIdx !== null) faceMesh.morphTargetInfluences[pressLIdx] *= 0.85;
            if (pressRIdx !== null) faceMesh.morphTargetInfluences[pressRIdx] *= 0.85;

            if (teethMesh?.morphTargetInfluences) {
                if (teethJawIdx !== null) teethMesh.morphTargetInfluences[teethJawIdx] *= 0.85;
                if (teethCloseIdx !== null) teethMesh.morphTargetInfluences[teethCloseIdx] *= 0.85;
                if (teethFunnelIdx !== null) teethMesh.morphTargetInfluences[teethFunnelIdx] *= 0.85;

                if (teethSmileLIdx !== null) teethMesh.morphTargetInfluences[teethSmileLIdx] *= 0.85;
                if (teethSmileRIdx !== null) teethMesh.morphTargetInfluences[teethSmileRIdx] *= 0.85;
                if (teethPressLIdx !== null) teethMesh.morphTargetInfluences[teethPressLIdx] *= 0.85;
                if (teethPressRIdx !== null) teethMesh.morphTargetInfluences[teethPressRIdx] *= 0.85;
            }
            return;
        }

        const s = lip.sample();

        const jawVal = MathUtils.clamp(s.jaw, 0, 1);
        const closeVal = MathUtils.clamp((1 - s.jaw) * 0.6, 0, 1);

        const wideVal = MathUtils.clamp(s.wide, 0, 1);
        const funnelVal = MathUtils.clamp(s.funnel, 0, 0.25); // hard cap: funnel is aggressive on RPM
        const pressVal = MathUtils.clamp(s.press, 0, 1);

        // Avoid "puckered press" which often flips the lower lip upward
        const pressSafe = MathUtils.clamp(pressVal * (1 - funnelVal) * 0.55, 0, 1);

        // Add less press into close, and use the safe press value
        const closeWithPress = MathUtils.clamp(closeVal + pressSafe * 0.25, 0, 1);

        if (jawIdx !== null) faceMesh.morphTargetInfluences[jawIdx] = jawVal;
        if (closeIdx !== null) faceMesh.morphTargetInfluences[closeIdx] = closeWithPress;
        if (funnelIdx !== null) faceMesh.morphTargetInfluences[funnelIdx] = funnelVal;

        if (smileLIdx !== null) faceMesh.morphTargetInfluences[smileLIdx] = wideVal * 0.6;
        if (smileRIdx !== null) faceMesh.morphTargetInfluences[smileRIdx] = wideVal * 0.6;

        if (pressLIdx !== null) faceMesh.morphTargetInfluences[pressLIdx] = pressVal * 0.8;
        if (pressRIdx !== null) faceMesh.morphTargetInfluences[pressRIdx] = pressVal * 0.8;

        if (teethMesh?.morphTargetInfluences) {
            if (teethJawIdx !== null) teethMesh.morphTargetInfluences[teethJawIdx] = jawVal;
            if (teethCloseIdx !== null) teethMesh.morphTargetInfluences[teethCloseIdx] = closeWithPress;
            if (teethFunnelIdx !== null) teethMesh.morphTargetInfluences[teethFunnelIdx] = funnelVal;

            if (teethSmileLIdx !== null) teethMesh.morphTargetInfluences[teethSmileLIdx] = wideVal * 0.6;
            if (teethSmileRIdx !== null) teethMesh.morphTargetInfluences[teethSmileRIdx] = wideVal * 0.6;

            if (teethPressLIdx !== null) teethMesh.morphTargetInfluences[teethPressLIdx] = pressVal * 0.8;
            if (teethPressRIdx !== null) teethMesh.morphTargetInfluences[teethPressRIdx] = pressVal * 0.8;
        }
    }, 2);

    return {
        ensureLipSyncRunning: lip.ensureRunning,
    };
}
