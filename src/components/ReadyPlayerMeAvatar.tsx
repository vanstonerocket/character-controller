import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";

type Props = {
  url: string;
  scale?: number;
};

export function ReadyPlayerMeAvatar({ url, scale = 1 }: Props) {
  const gltf = useGLTF(url) as any;

  // Clone so React Three Fiber can mount safely even if you reuse the asset
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  useEffect(() => {
    scene.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [scene]);

  return <primitive object={scene} scale={scale} />;
}