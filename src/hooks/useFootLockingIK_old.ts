// useFootLockingIK.ts
//
// Foot locking + stable 2-bone IK for ReadyPlayerMe / Mixamo-style rigs in R3F + Rapier.
//
// What your logs showed:
// - hitY == originY => toi == 0 => ray is immediately intersecting something at the origin.
// That is almost always a self-hit (character capsule) OR the filterGroups param is not being applied.
//
// This file fixes that by:
// - Trying several common castRay signatures to apply raycastGroups.
// - Rejecting near-zero toi hits and retrying the ray from a higher origin.
// - Keeping debug logs readable and actionable.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Bone, Group, Object3D, Quaternion, Vector3 } from "three";

type FootLockingOptions = {
    groundY?: number;
    debugFlatGround?: boolean;

    debugLog?: boolean;
    debugEveryNFrames?: number;

    rayUp?: number;
    rayLen?: number;

    // Either a packed number (like your collisionGroups) or interactionGroups(...) output.
    raycastGroups?: any;

    // When we detect a near-zero TOI (self hit), we retry from higher up by this amount.
    selfHitRetryUp?: number;

    // Treat TOI <= this as self-hit
    minToi?: number;

    footNear?: number;
    unlockSpeed?: number;
    lockSpeed?: number;
    lockFrames?: number;
    maxLockDrift?: number;

    footLift?: number;
    footNormalBlend?: number;

    warnHitAboveAnkle?: number;
};

type RapierLike = {
    Ray: new (
        origin: { x: number; y: number; z: number },
        dir: { x: number; y: number; z: number }
    ) => any;
};

type RapierWorldLike = {
    castRay: (...args: any[]) => any;
};

type LegRig = {
    side: "L" | "R";
    hip: Bone;
    knee: Bone;
    ankle: Bone;
    foot: Bone;
    toe?: Bone;
};

type FootState = {
    locked: boolean;
    lockPoint: Vector3;
    lockNormal: Vector3;

    prevAnklePos: Vector3;
    initialized: boolean;

    lockableFrames: number;

    lastHitY: number;
    lastAnkleToGround: number;
    lastSpeed: number;
    lastDrift: number;

    loggedBadHitOnce: boolean;
    loggedAboveAnkleOnce: boolean;
    loggedNoHitOnce: boolean;
};

const V3_A = new Vector3();
const V3_B = new Vector3();
const V3_C = new Vector3();
const V3_D = new Vector3();
const Q_A = new Quaternion();
const Q_B = new Quaternion();
const Q_C = new Quaternion();

function lower(s: string) {
    return s.toLowerCase();
}

function isBone(o: Object3D): o is Bone {
    return (o as any).isBone === true;
}

function findFirstBoneByName(root: Object3D, candidates: string[]): Bone | null {
    const wanted = candidates.map(lower);
    let found: Bone | null = null;

    root.traverse((o) => {
        if (found) return;
        if (!isBone(o)) return;
        const n = lower(o.name);
        if (wanted.some((w) => n === w || n.includes(w))) found = o;
    });

    return found;
}

function findLegRig(scene: Object3D, side: "L" | "R", debugLog?: boolean): LegRig | null {
    const prefix = side === "L" ? "left" : "right";

    const hipNames = [
        `${prefix}upleg`,
        `${prefix} up leg`,
        `${prefix}thigh`,
        `${prefix}hip`,
        `${prefix}up_leg`,
        `${prefix}upperleg`,
        `mixamorig:${side === "L" ? "left" : "right"}upleg`,
        `${side === "L" ? "left" : "right"}upleg`,
        `${side === "L" ? "left" : "right"}upperleg`,
    ];

    const kneeNames = [
        `${prefix}leg`,
        `${prefix} lower leg`,
        `${prefix}knee`,
        `${prefix}calf`,
        `mixamorig:${side === "L" ? "left" : "right"}leg`,
        `${side === "L" ? "left" : "right"}leg`,
        `${side === "L" ? "left" : "right"}lowerleg`,
    ];

    const ankleNames = [
        `${prefix}foot`,
        `${prefix} ankle`,
        `mixamorig:${side === "L" ? "left" : "right"}foot`,
        `${side === "L" ? "left" : "right"}foot`,
    ];

    const toeNames = [
        `${prefix}toebase`,
        `${prefix} toe`,
        `mixamorig:${side === "L" ? "left" : "right"}toebase`,
        `${side === "L" ? "left" : "right"}toebase`,
    ];

    const hip = findFirstBoneByName(scene, hipNames);
    const knee = findFirstBoneByName(scene, kneeNames);
    const ankle = findFirstBoneByName(scene, ankleNames);

    if (!hip || !knee || !ankle) {
        if (debugLog) {
            // eslint-disable-next-line no-console
            console.warn("[useFootLockingIK] Could not resolve leg bones for side", side, {
                hip: hip?.name,
                knee: knee?.name,
                ankle: ankle?.name,
            });
        }
        return null;
    }

    const toe = findFirstBoneByName(scene, toeNames) ?? undefined;
    const foot = ankle;

    if (debugLog) {
        // eslint-disable-next-line no-console
        console.log("[useFootLockingIK] Resolved rig", side, {
            hip: hip.name,
            knee: knee.name,
            ankle: ankle.name,
            toe: toe?.name,
        });
    }

    return { side, hip, knee, ankle, foot, toe };
}

function setLocalQuaternionFromWorld(bone: Object3D, desiredWorldQuat: Quaternion) {
    if (!bone.parent) {
        bone.quaternion.copy(desiredWorldQuat);
        return;
    }
    bone.parent.getWorldQuaternion(Q_A);
    Q_A.invert();
    bone.quaternion.copy(Q_A.multiply(desiredWorldQuat));
}

function extractToi(hit: any): number | null {
    if (!hit) return null;
    const candidates = [hit.toi, hit.timeOfImpact, hit?.hit?.toi, hit?.hit?.timeOfImpact];
    for (const c of candidates) if (typeof c === "number" && Number.isFinite(c)) return c;
    if (typeof hit.toi === "function") {
        try {
            const v = hit.toi();
            if (typeof v === "number" && Number.isFinite(v)) return v;
        } catch {
            // ignore
        }
    }
    return null;
}

function extractNormal(hit: any): Vector3 | null {
    const n = hit?.normal ?? hit?.normal1 ?? hit?.hit?.normal ?? hit?.hit?.normal1 ?? null;
    if (n && typeof n.x === "number" && typeof n.y === "number" && typeof n.z === "number") {
        if (Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z)) {
            return new Vector3(n.x, n.y, n.z).normalize();
        }
    }
    return null;
}

type CastAttempt = {
    hit: any;
    toi: number | null;
    sig: string;
};

function castRayWithGroups(
    world: RapierWorldLike,
    ray: any,
    maxToi: number,
    solid: boolean,
    groups: any
): CastAttempt[] {
    // Try several common call patterns.
    // Different bindings expose different parameter ordering for filterGroups.
    const attempts: CastAttempt[] = [];

    const tryCall = (sig: string, fn: () => any) => {
        try {
            const hit = fn();
            attempts.push({ hit, toi: extractToi(hit), sig });
        } catch (e) {
            attempts.push({ hit: null, toi: null, sig: `${sig} (threw)` });
        }
    };

    // Pattern A: castRay(ray, maxToi, solid, filterFlags, filterGroups, excludeCollider, excludeRigidBody)
    tryCall("A: groups as 5th arg", () => world.castRay(ray, maxToi, solid, undefined, groups));

    // Pattern B: castRay(ray, maxToi, solid, filterGroups)
    tryCall("B: groups as 4th arg", () => world.castRay(ray, maxToi, solid, groups));

    // Pattern C: castRay(ray, maxToi, solid, filterFlags, filterGroups, excludeCollider)
    tryCall("C: groups as 5th arg + extra", () => world.castRay(ray, maxToi, solid, undefined, groups, undefined));

    return attempts;
}

function chooseBestHit(attempts: CastAttempt[], minToi: number): CastAttempt | null {
    // Prefer smallest positive toi above minToi
    let best: CastAttempt | null = null;
    for (const a of attempts) {
        if (!a.hit) continue;
        if (a.toi === null) continue;
        if (!(a.toi > minToi)) continue;
        if (!best || (best.toi ?? Infinity) > a.toi) best = a;
    }
    return best;
}

function twoBoneIKSolveWorld(
    hip: Bone,
    knee: Bone,
    ankle: Bone,
    targetWorld: Vector3,
    poleHintWorld: Vector3
) {
    hip.updateWorldMatrix(true, false);

    const hipPos = V3_A;
    const kneePos = V3_B;
    const anklePos = V3_C;

    hip.getWorldPosition(hipPos);
    knee.getWorldPosition(kneePos);
    ankle.getWorldPosition(anklePos);

    const upperLen = hipPos.distanceTo(kneePos);
    const lowerLen = kneePos.distanceTo(anklePos);

    const dirHT = V3_D.copy(targetWorld).sub(hipPos);
    let distHT = dirHT.length();
    if (distHT < 1e-5) return;

    const maxReach = upperLen + lowerLen - 1e-4;
    const minReach = Math.abs(upperLen - lowerLen) + 1e-4;
    distHT = Math.min(maxReach, Math.max(minReach, distHT));
    dirHT.normalize();

    const pole = V3_C.copy(poleHintWorld).sub(hipPos);
    pole.addScaledVector(dirHT, -pole.dot(dirHT));

    if (pole.lengthSq() < 1e-8) {
        pole.copy(kneePos).sub(hipPos);
        pole.addScaledVector(dirHT, -pole.dot(dirHT));
    }
    if (pole.lengthSq() < 1e-8) return;
    pole.normalize();

    const xAxis = dirHT;
    const yAxis = pole;

    const zAxis = V3_B.crossVectors(xAxis, yAxis).normalize();
    yAxis.copy(V3_C.crossVectors(zAxis, xAxis)).normalize();

    const xk = (upperLen * upperLen - lowerLen * lowerLen + distHT * distHT) / (2 * distHT);
    const h2 = Math.max(0, upperLen * upperLen - xk * xk);
    const hk = Math.sqrt(h2);

    const desiredKneeWorld = V3_D.copy(hipPos).addScaledVector(xAxis, xk).addScaledVector(yAxis, hk);

    const curHipToKnee = V3_B.copy(kneePos).sub(hipPos).normalize();
    const desHipToKnee = V3_C.copy(desiredKneeWorld).sub(hipPos).normalize();

    Q_A.setFromUnitVectors(curHipToKnee, desHipToKnee);
    hip.getWorldQuaternion(Q_B);
    Q_C.copy(Q_A).multiply(Q_B);
    setLocalQuaternionFromWorld(hip, Q_C);
    hip.updateWorldMatrix(true, false);

    knee.getWorldPosition(kneePos);
    ankle.getWorldPosition(anklePos);

    const curKneeToAnkle = V3_B.copy(anklePos).sub(kneePos).normalize();
    const desKneeToTarget = V3_C.copy(targetWorld).sub(kneePos).normalize();

    Q_A.setFromUnitVectors(curKneeToAnkle, desKneeToTarget);
    knee.getWorldQuaternion(Q_B);
    Q_C.copy(Q_A).multiply(Q_B);
    setLocalQuaternionFromWorld(knee, Q_C);
    knee.updateWorldMatrix(true, false);
}

function rotateFootToNormal(footBone: Bone, groundNormalWorld: Vector3, blend: number) {
    if (blend <= 0) return;

    footBone.getWorldQuaternion(Q_A);
    V3_A.set(0, 1, 0).applyQuaternion(Q_A).normalize();
    Q_B.setFromUnitVectors(V3_A, groundNormalWorld.clone().normalize());
    Q_C.identity().slerp(Q_B, Math.min(1, Math.max(0, blend)));
    Q_C.multiply(Q_A);

    setLocalQuaternionFromWorld(footBone, Q_C);
    footBone.updateWorldMatrix(true, false);
}

function fmt(n: number) {
    if (!Number.isFinite(n)) return "NaN";
    return n.toFixed(3);
}

export function useFootLockingIK(
    avatarScene: Group | Object3D | null | undefined,
    isGrounded: boolean,
    rapier: RapierLike,
    world: RapierWorldLike,
    opts?: FootLockingOptions
) {
    const options = useMemo<Required<FootLockingOptions>>(() => {
        return {
            groundY: opts?.groundY ?? 0,
            debugFlatGround: opts?.debugFlatGround ?? false,

            debugLog: opts?.debugLog ?? false,
            debugEveryNFrames: opts?.debugEveryNFrames ?? 20,

            rayUp: opts?.rayUp ?? 0.8,
            rayLen: opts?.rayLen ?? 2.0,
            raycastGroups: opts?.raycastGroups ?? undefined,

            selfHitRetryUp: opts?.selfHitRetryUp ?? 0.35,
            minToi: opts?.minToi ?? 1e-3,

            footNear: opts?.footNear ?? 0.3,
            unlockSpeed: opts?.unlockSpeed ?? 0.8,
            lockSpeed: opts?.lockSpeed ?? 0.25,
            lockFrames: opts?.lockFrames ?? 3,
            maxLockDrift: opts?.maxLockDrift ?? 0.22,

            footLift: opts?.footLift ?? 0.02,
            footNormalBlend: opts?.footNormalBlend ?? 0,

            warnHitAboveAnkle: opts?.warnHitAboveAnkle ?? 0.15,
        };
    }, [opts]);

    const rigsRef = useRef<{ left?: LegRig; right?: LegRig }>({});

    const mkState = (): FootState => ({
        locked: false,
        lockPoint: new Vector3(),
        lockNormal: new Vector3(0, 1, 0),
        prevAnklePos: new Vector3(),
        initialized: false,
        lockableFrames: 0,
        lastHitY: 0,
        lastAnkleToGround: 0,
        lastSpeed: 0,
        lastDrift: 0,
        loggedBadHitOnce: false,
        loggedAboveAnkleOnce: false,
        loggedNoHitOnce: false,
    });

    const leftState = useRef<FootState>(mkState());
    const rightState = useRef<FootState>(mkState());
    const frameCount = useRef(0);

    useEffect(() => {
        if (!avatarScene) return;

        rigsRef.current.left = findLegRig(avatarScene, "L", options.debugLog) ?? undefined;
        rigsRef.current.right = findLegRig(avatarScene, "R", options.debugLog) ?? undefined;

        const l = rigsRef.current.left;
        const r = rigsRef.current.right;

        if (l) {
            l.ankle.getWorldPosition(leftState.current.prevAnklePos);
            leftState.current.initialized = true;
        }
        if (r) {
            r.ankle.getWorldPosition(rightState.current.prevAnklePos);
            rightState.current.initialized = true;
        }

        if (options.debugLog) {
            // eslint-disable-next-line no-console
            console.log("[useFootLockingIK] Initialized", {
                raycastGroups: options.raycastGroups ?? "unset",
                note: "If you see hitY==originY, that is a self-hit (toi~0). This file will retry higher and skip toi<=minToi.",
            });
        }
    }, [avatarScene, options.debugLog, options.raycastGroups, options.minToi]);

    useFrame((_, delta) => {
        if (!avatarScene) return;

        frameCount.current += 1;
        const doPeriodicLog =
            options.debugLog && frameCount.current % Math.max(1, options.debugEveryNFrames) === 0;

        const left = rigsRef.current.left;
        const right = rigsRef.current.right;
        if (!left && !right) return;

        if (!isGrounded) {
            leftState.current.locked = false;
            rightState.current.locked = false;
            leftState.current.lockableFrames = 0;
            rightState.current.lockableFrames = 0;

            if (left) left.ankle.getWorldPosition(leftState.current.prevAnklePos);
            if (right) right.ankle.getWorldPosition(rightState.current.prevAnklePos);
            return;
        }

        const solveFoot = (leg: LegRig, state: FootState) => {
            leg.ankle.getWorldPosition(V3_A);

            const speed =
                state.initialized && delta > 1e-6
                    ? V3_B.copy(V3_A).sub(state.prevAnklePos).length() / delta
                    : 0;

            const baseOrigin = V3_B.copy(V3_A);
            baseOrigin.y += options.rayUp;

            let hitY = options.groundY;
            let hitNormal = V3_C.set(0, 1, 0);
            let usedSig = "none";

            if (!options.debugFlatGround) {
                const castFromOrigin = (origin: Vector3) => {
                    const ray = new rapier.Ray(
                        { x: origin.x, y: origin.y, z: origin.z },
                        { x: 0, y: -1, z: 0 }
                    );

                    const attempts = options.raycastGroups !== undefined
                        ? castRayWithGroups(world, ray, options.rayLen, true, options.raycastGroups)
                        : [{ hit: world.castRay(ray, options.rayLen, true), toi: null as number | null, sig: "no groups" }];

                    // Fill toi for "no groups"
                    for (const a of attempts) if (a.sig === "no groups") a.toi = extractToi(a.hit);

                    const best = chooseBestHit(attempts, options.minToi);
                    return { best, attempts };
                };

                // First attempt
                let { best, attempts } = castFromOrigin(baseOrigin);

                // If we did not get a valid hit, OR we got only self hits (toi <= minToi), retry higher
                if (!best) {
                    const retryOrigin = V3_D.copy(baseOrigin);
                    retryOrigin.y += options.selfHitRetryUp;
                    const retry = castFromOrigin(retryOrigin);
                    if (retry.best) {
                        best = retry.best;
                        attempts = retry.attempts;
                        usedSig = `${best.sig} (retry up)`;
                        hitY = retryOrigin.y - (best.toi as number);
                        const n = extractNormal(best.hit);
                        if (n) hitNormal.copy(n);
                    } else {
                        // No usable hit at all
                        if (options.debugLog && !state.loggedNoHitOnce) {
                            state.loggedNoHitOnce = true;
                            // eslint-disable-next-line no-console
                            console.warn(`[useFootLockingIK] ${leg.side} no valid ground hit.`, {
                                baseOrigin: { x: fmt(baseOrigin.x), y: fmt(baseOrigin.y), z: fmt(baseOrigin.z) },
                                retryUp: options.selfHitRetryUp,
                                rayLen: options.rayLen,
                                minToi: options.minToi,
                                raycastGroups: options.raycastGroups ?? "unset",
                                attempts: attempts.map((a) => ({ sig: a.sig, toi: a.toi })),
                            });
                        }
                        state.locked = false;
                        state.lockableFrames = 0;
                        state.prevAnklePos.copy(V3_A);
                        state.initialized = true;
                        return;
                    }
                } else {
                    usedSig = best.sig;
                    hitY = baseOrigin.y - (best.toi as number);
                    const n = extractNormal(best.hit);
                    if (n) hitNormal.copy(n);
                }
            }

            const ankleToGround = V3_A.y - hitY;

            state.lastHitY = hitY;
            state.lastAnkleToGround = ankleToGround;
            state.lastSpeed = speed;

            // If we still end up "hitting above ankle", it means we are not really hitting ground.
            if (
                options.debugLog &&
                !state.loggedAboveAnkleOnce &&
                ankleToGround < -Math.abs(options.warnHitAboveAnkle)
            ) {
                state.loggedAboveAnkleOnce = true;
                // eslint-disable-next-line no-console
                console.warn(`[useFootLockingIK] ${leg.side} hit ABOVE ankle.`, {
                    ankleY: fmt(V3_A.y),
                    baseOriginY: fmt(V3_A.y + options.rayUp),
                    hitY: fmt(hitY),
                    ankleToGround: fmt(ankleToGround),
                    usedSig,
                    hint: "This is almost always self-hit. Ensure raycastGroups only includes the floor, or pass exclude rigidbody.",
                });
            }

            if (doPeriodicLog) {
                // eslint-disable-next-line no-console
                console.log(`[useFootLockingIK] ${leg.side} tick`, {
                    locked: state.locked,
                    ankleY: fmt(V3_A.y),
                    hitY: fmt(hitY),
                    ankleToGround: fmt(ankleToGround),
                    speed: fmt(speed),
                    usedSig,
                });
            }

            // Locking logic
            const nearEnough = ankleToGround >= -0.05 && ankleToGround <= options.footNear;
            const slowEnough = speed <= options.lockSpeed;
            const lockableNow = nearEnough && slowEnough;

            if (!state.locked) {
                state.lockableFrames = lockableNow ? state.lockableFrames + 1 : 0;

                if (state.lockableFrames >= options.lockFrames) {
                    state.locked = true;
                    state.lockableFrames = options.lockFrames;
                    state.lockPoint.set(V3_A.x, hitY, V3_A.z);
                    state.lockNormal.copy(hitNormal);

                    if (options.debugLog) {
                        // eslint-disable-next-line no-console
                        console.log(`[useFootLockingIK] Lock ${leg.side}`, {
                            ankleToGround: fmt(ankleToGround),
                            speed: fmt(speed),
                            usedSig,
                            lockPoint: state.lockPoint.toArray().map((v) => Number(v.toFixed(3))),
                        });
                    }
                }
            } else {
                const shouldUnlockBySpeed = speed > options.unlockSpeed;
                const stillNear = ankleToGround >= -0.10 && ankleToGround <= options.footNear + 0.10;

                const drift = V3_B.copy(V3_A).setY(hitY).distanceTo(state.lockPoint);
                state.lastDrift = drift;

                if (shouldUnlockBySpeed || !stillNear || drift > options.maxLockDrift) {
                    state.locked = false;
                    state.lockableFrames = 0;

                    if (options.debugLog) {
                        // eslint-disable-next-line no-console
                        console.log(`[useFootLockingIK] Unlock ${leg.side}`, {
                            ankleToGround: fmt(ankleToGround),
                            speed: fmt(speed),
                            drift: fmt(drift),
                        });
                    }
                } else {
                    state.lockNormal.lerp(hitNormal, 0.15).normalize();
                }
            }

            state.prevAnklePos.copy(V3_A);
            state.initialized = true;

            if (!state.locked) return;

            const target = V3_B.copy(state.lockPoint);
            target.y += options.footLift;

            leg.knee.getWorldPosition(V3_C);
            twoBoneIKSolveWorld(leg.hip, leg.knee, leg.ankle, target, V3_C);

            if (options.footNormalBlend > 0 && leg.foot !== leg.ankle) {
                rotateFootToNormal(leg.foot, state.lockNormal, options.footNormalBlend);
            }

            if (leg.toe) {
                leg.toe.getWorldQuaternion(Q_A);
                V3_A.set(1, 0, 0).applyQuaternion(Q_A).normalize();
                Q_B.setFromAxisAngle(V3_A, 0.03);
                Q_B.multiply(Q_A);
                setLocalQuaternionFromWorld(leg.toe, Q_B);
                leg.toe.updateWorldMatrix(true, false);
            }
        };

        if (left) solveFoot(left, leftState.current);
        if (right) solveFoot(right, rightState.current);

        avatarScene.updateMatrixWorld(true);
    }, 2);
}
