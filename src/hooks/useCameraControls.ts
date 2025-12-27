import { useControls } from 'leva';

export function useCameraControls() {
  return useControls('Camera', {
    height: { value: 1, min: -3, max: 10, step: 0.1 },
    distance: { value: 1.5, min: 0, max: 20, step: 0.1 },
    pitch: { value: 5, min: -89, max: 89, step: 1 }, // up / down
    yaw: { value: 0, min: -180, max: 180, step: 1 },   // left / right
    smoothness: { value: 1, min: 0.01, max: 1, step: 0.01 }
  });
}