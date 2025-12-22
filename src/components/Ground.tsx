import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { Decal } from "@react-three/drei";
import { CanvasTexture, Vector3 } from "three";

type GroundProps = {
  target?: React.RefObject<any>;
};

export function Ground({ target }: GroundProps) {
  // Arena sizing
  const groundY = -1;
  const groundSize = 15;

  const wallHeight = 10;
  const wallThickness = 1;
  const wallCenterY = groundY + wallHeight / 2;

  // Render-only floor mesh (Decal projects onto this geometry)
  const floorRef = useRef<THREE.Mesh>(null);
  const decalPos = useRef(new Vector3(0, 0, 0));

  // Create a soft circular texture at runtime (no asset file needed)
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

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);

  // Follow character X/Z only
  useFrame(() => {
    const p = target?.current?.position;
    if (!p) return;

    decalPos.current.set(p.x, 0, p.z);
  });

  return (
    <group>
      {/* Physics floor only (invisible) */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[groundSize / 2, 0.05, groundSize / 2]}
          position={[0, groundY, 0]}
        />
      </RigidBody>

      {/* Render-only floor mesh that Decal projects onto */}
      <mesh
        ref={floorRef}
        position={[0, groundY, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[groundSize, groundSize]} />

        {/* This hides the floor mesh without hiding children (Decal) */}
        <meshStandardMaterial transparent opacity={0} depthWrite={false} />

        {/* Decal: circular mark under the character */}
        {circleTex && (
          <Decal
            position={decalPos.current}
            rotation={[0, 0, 0]}
            scale={[10, 10, 0]} // circle size in world units
          >
            <meshStandardMaterial
              map={circleTex}
              transparent
              opacity={1}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-4}
            />
          </Decal>
        )}
      </mesh>

      {/* Invisible physics-only walls */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[groundSize / 2, wallHeight / 2, wallThickness / 2]}
          position={[0, wallCenterY, -groundSize / 2]}
        />
        <CuboidCollider
          args={[groundSize / 2, wallHeight / 2, wallThickness / 2]}
          position={[0, wallCenterY, groundSize / 2]}
        />
        <CuboidCollider
          args={[groundSize / 2, wallHeight / 2, wallThickness / 2]}
          position={[groundSize / 2, wallCenterY, 0]}
          rotation={[0, Math.PI / 2, 0]}
        />
        <CuboidCollider
          args={[groundSize / 2, wallHeight / 2, wallThickness / 2]}
          position={[-groundSize / 2, wallCenterY, 0]}
          rotation={[0, Math.PI / 2, 0]}
        />
      </RigidBody>
    </group>
  );
}
