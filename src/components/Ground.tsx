// Ground.tsx

import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { Decal } from "@react-three/drei";
import { CanvasTexture, Vector3 } from "three";

type GroundProps = {
  target?: React.RefObject<any>;
};

export function Ground({ target }: GroundProps) {
  // ===== WORLD CONSTANTS =====
  const groundY = 0;
  const groundThickness = 0.05;
  const groundSize = 15;

  const wallHeight = 10;
  const wallThickness = 1;

  // Walls sit on top of the ground plane
  const wallCenterY = groundY + wallHeight / 2;

  // ===== DECAL =====
  const floorRef = useRef<THREE.Mesh>(null);
  const decalPos = useRef(new Vector3());

  const circleTex = useMemo(() => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.45;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0.3, "rgba(0,0,0,1.0)");
    grad.addColorStop(0.95, "rgba(0,0,0,0.25)");
    grad.addColorStop(1.0, "rgba(0,0,0,0.0)");

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);


  // Follow character X/Z, stay on ground plane
  useFrame(() => {
    const posObj = target?.current?.position;
    if (!posObj?.clone) return;

    const p = posObj.clone(); // Vector3 from CharacterController
    decalPos.current.set(p.x, groundY, p.z);
  });

  //useEffect(() => {
  //  console.log("GROUND CHECK", {
  //    groundY,
  //    floorMeshY: floorRef.current?.position.y,
  //  });
  //console.log("FLOOR COLLIDER CHECK", {
  //  groundY,
  //  groundThickness,
  //  colliderCenterY: groundY - groundThickness,
  //  colliderTopY: (groundY - groundThickness) + groundThickness,
  //});
  //}, []);

  return (
    <group>
      {/* ===== FLOOR PHYSICS ===== */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[groundSize / 2, groundThickness, groundSize / 2]}
          position={[0, groundY - groundThickness, 0]}
          collisionGroups={0x00010004} // floor: member 1, mask 4
        />
      </RigidBody>

      {/* ===== FLOOR RENDER ===== */}
      <mesh
        ref={floorRef}
        position={[0, groundY, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[groundSize, groundSize]} />
        <meshStandardMaterial
          map={circleTex}
          transparent
          opacity={1}

        />

        {circleTex && (
          <Decal
            position={decalPos.current}
            rotation={[0, 0, 0]}
            scale={[10, 10, 0]}
          >
            <meshStandardMaterial
              map={circleTex}
              transparent
              opacity={1}
              depthWrite={false}

            />
          </Decal>
        )}
      </mesh>

      {/* ===== WALL PHYSICS ===== */}

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[groundSize / 2, wallHeight / 2, wallThickness / 2]}
          position={[0, wallCenterY, -groundSize / 2]}
          collisionGroups={0x00020004} // walls: member 2, mask 4
        />
        <CuboidCollider
          args={[groundSize / 2, wallHeight / 2, wallThickness / 2]}
          position={[0, wallCenterY, groundSize / 2]}
          collisionGroups={0x00020004} // walls: member 2, mask 4
        />
        <CuboidCollider
          args={[groundSize / 2, wallHeight / 2, wallThickness / 2]}
          position={[groundSize / 2, wallCenterY, 0]}
          rotation={[0, Math.PI / 2, 0]}
          collisionGroups={0x00020004} // walls: member 2, mask 4
        />
        <CuboidCollider
          args={[groundSize / 2, wallHeight / 2, wallThickness / 2]}
          position={[-groundSize / 2, wallCenterY, 0]}
          rotation={[0, Math.PI / 2, 0]}
          collisionGroups={0x00020004} // walls: member 2, mask 4
        />
      </RigidBody>
    </group>
  );
}
