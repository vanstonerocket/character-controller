import React, { useImperativeHandle, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3, MathUtils } from "three";
import {
  CapsuleCollider,
  RigidBody,
  type RigidBodyApi,
  useRapier,
} from "@react-three/rapier";
import { useKeyboardControls } from "@react-three/drei";

import { useCharacterControls } from "../hooks/useCharacterControls";
import {
  calculateMovement,
  createJumpImpulse,
  createMovementVelocity,
} from "../utils/physics";
import { useMobileControls } from "../contexts/MobileControlsContext";
import { CharacterModel } from "./CharacterModel";

const DEBUG_GROUND = false;

export const CharacterController = React.forwardRef<any>((_, ref) => {
  const rigidBody = useRef<RigidBodyApi>(null);
  const modelRef = useRef<THREE.Group>(null);

  const { rapier, world } = useRapier();
  const { isJumping: isMobileJumping, movement: mobileMovement } = useMobileControls();
  const [, getKeys] = useKeyboardControls();
  const controls = useCharacterControls();

  const [isSprinting, setIsSprinting] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [isGrounded, setIsGrounded] = useState(false);

  // Avoid re-rendering every frame by only committing state when it changes
  const isMovingRef = useRef(false);
  const isSprintingRef = useRef(false);
  const isGroundedRef = useRef(false);

  const targetRotation = useRef(0);
  const currentRotation = useRef(0);

  useFrame(() => {
    const rb = rigidBody.current;
    if (!rb) return;

    const translation = rb.translation();

    // Ground detection via multiple rays
    const rayLength = 1.5;
    const rayDir = { x: 0, y: -1, z: 0 };

    const rayOffsets = [
      { x: 0, z: 0 },
      { x: 0.3, z: 0 },
      { x: -0.3, z: 0 },
      { x: 0, z: 0.3 },
      { x: 0, z: -0.3 },
    ];

    let groundedNow = false;
    let closestHit: any = null;

    for (const offset of rayOffsets) {
      const ray = new rapier.Ray(
        {
          x: translation.x + offset.x,
          y: translation.y,
          z: translation.z + offset.z,
        },
        rayDir
      );

      const hit = world.castRay(
        ray,
        rayLength,
        true,
        undefined,
        undefined,
        undefined,
        rb
      );

      if (hit && (!closestHit || hit.toi < closestHit.toi)) {
        closestHit = hit;
        groundedNow = true;
      }
    }

    if (groundedNow !== isGroundedRef.current) {
      isGroundedRef.current = groundedNow;
      setIsGrounded(groundedNow);
      if (DEBUG_GROUND) {
        console.log(`Ground state changed: ${groundedNow ? "Grounded" : "In Air"}`);
      }
    }

    const input = getKeys();
    const shouldJump = input.jump || isMobileJumping;

    const linvel = rb.linvel();

    // Movement state (only update React state if it changes)
    const horizontalSpeed = Math.sqrt(linvel.x * linvel.x + linvel.z * linvel.z);

    const movingNow = horizontalSpeed > 0.5;
    if (movingNow !== isMovingRef.current) {
      isMovingRef.current = movingNow;
      setIsMoving(movingNow);
    }

    const sprintNow = !!input.sprint && horizontalSpeed > 0.5;
    if (sprintNow !== isSprintingRef.current) {
      isSprintingRef.current = sprintNow;
      setIsSprinting(sprintNow);
    }

    // Update rotation based on velocity
    if (Math.abs(linvel.x) > 0.1 || Math.abs(linvel.z) > 0.1) {
      targetRotation.current = Math.atan2(linvel.x, linvel.z);

      let angleDiff = targetRotation.current - currentRotation.current;
      if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      else if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      targetRotation.current = currentRotation.current + angleDiff;
    }

    // Smooth rotation
    if (modelRef.current) {
      currentRotation.current = MathUtils.lerp(
        currentRotation.current,
        targetRotation.current,
        0.2
      );
      modelRef.current.rotation.y = currentRotation.current;
    }

    // Handle movement
    let movement = calculateMovement(input, controls.moveSpeed);

    // Override keyboard movement with mobile joystick if active
    if (Math.abs(mobileMovement.x) > 0 || Math.abs(mobileMovement.y) > 0) {
      movement = {
        sprint: false,
        normalizedX: mobileMovement.x,
        normalizedZ: mobileMovement.y,
      };
    }

    if (movement) {
      const sprintMultiplier = movement.sprint ? controls.sprintMultiplier : 1;
      const moveForce = controls.moveSpeed * (groundedNow ? 1 : controls.airControl);

      const velocity = createMovementVelocity(
        movement.normalizedX,
        movement.normalizedZ,
        moveForce * sprintMultiplier,
        linvel.y
      );

      // Smooth out velocity changes when grounded
      if (groundedNow) {
        const smoothing = 0.25;
        velocity.x = velocity.x * smoothing + linvel.x * (1 - smoothing);
        velocity.z = velocity.z * smoothing + linvel.z * (1 - smoothing);
      }

      rb.setLinvel(velocity, true);
    }

    // Gentle "stick to ground" clamp, avoids micro upward bumps on slopes
    if (groundedNow && !shouldJump) {
      const lv = rb.linvel();
      if (lv.y > 0) rb.setLinvel({ x: lv.x, y: 0, z: lv.z }, true);
    }

    // Handle jumping (dynamic friendly)
    if (shouldJump && groundedNow) {
      rb.setLinvel({ x: linvel.x, y: 0, z: linvel.z }, true);
      rb.applyImpulse(createJumpImpulse(controls.jumpForce, { y: linvel.y }), true);
    }

    // Note: removed kinematic-style ground snapping (setTranslation + snap impulse)
    // Dynamic bodies should not be teleported each frame.
  });

  // Expose position to camera/controller systems
  useImperativeHandle(
    ref,
    () => ({
      position: {
        clone: () => {
          const t = rigidBody.current?.translation();
          return new Vector3(t?.x || 0, t?.y || 0, t?.z || 0);
        },
      },
    }),
    []
  );

  return (
    <RigidBody
      ref={rigidBody}
      colliders={false}
      position={[0.0, 0.0, 1]}
      lockRotations
      type="dynamic"
    >
      <CapsuleCollider args={[0.8, 0.4]} offset={[0, 1.2, 0]} />
      <group ref={modelRef} position={[0, -1.15, 0]} scale={1.5}>
        <CharacterModel isMoving={isMoving} isSprinting={isSprinting} isGrounded={isGrounded} />
      </group>
    </RigidBody>
  );
});
