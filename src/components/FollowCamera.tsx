// ...existing code...
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import { PerspectiveCamera } from '@react-three/drei';
import { useCameraControls } from '../hooks/useCameraControls';

type FollowCameraProps = {
  target: { current: { position: Vector3 } | null };
};

export function FollowCamera({ target }: FollowCameraProps) {
  const cameraRef = useRef<THREE.Group>(null);
  const controls = useCameraControls();
  const currentPos = useRef(new Vector3());
  
  useFrame((state) => {
    if (!target.current || !cameraRef.current) return;

    const position = target.current.position;

    // convert degrees -> radians
    const pitchRad = (controls.pitch ?? 0) * (Math.PI / 180);
    const yawRad = (controls.yaw ?? 0) * (Math.PI / 180);
    const dist = controls.distance ?? 1;
    const height = controls.height ?? 1;

    // Spherical-style offset:
    // horiz = distance projected onto XZ plane, y uses height + vertical component from pitch
    const horiz = dist * Math.cos(pitchRad);
    const offset = new Vector3(
      horiz * Math.sin(yawRad),                 // x
      height + dist * Math.sin(pitchRad),      // y
      horiz * Math.cos(yawRad)                  // z
    );

    const targetPos = position.clone().add(offset);

    // Smooth camera movement (smoothness should be 0..1 for lerp factor)
    currentPos.current.lerp(targetPos, controls.smoothness ?? 0.1);
    state.camera.position.copy(currentPos.current);

    // Look at the target's head (respecting height)
    state.camera.lookAt(position.clone().add(new Vector3(0, height, 0)));
  });

  return (
    <group ref={cameraRef}>
      <PerspectiveCamera makeDefault position={[0, controls.height, controls.distance]} fov={75}>
        <meshBasicMaterial attach="material" color="red" />
      </PerspectiveCamera>
    </group>
  );

  
  useFrame((state) => {
    if (!target.current || !cameraRef.current) return;

    const position = target.current.position;
    const targetPos = position.clone().add(new Vector3(0, controls.height, controls.distance));

    // Smooth camera movement
    currentPos.current.lerp(targetPos, controls.smoothness);
    state.camera.position.copy(currentPos.current);
    // state.camera.lookAt(position.clone());
    state.camera.lookAt(position.clone().add(new Vector3(0, controls.height, 0)));
  });

  return (
    <group ref={cameraRef}>
      <PerspectiveCamera makeDefault position={[0, controls.height, controls.distance]} fov={75}>
        <meshBasicMaterial attach="material" color="red" />
      </PerspectiveCamera>
    </group>
  );
}