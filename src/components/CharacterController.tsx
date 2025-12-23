import React from 'react';
import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3, MathUtils } from 'three';
import { CapsuleCollider, RigidBody, RigidBodyApi, useRapier } from '@react-three/rapier';
import { useKeyboardControls } from '@react-three/drei';
import { useCharacterControls } from '../hooks/useCharacterControls';
import { calculateMovement, createJumpImpulse, createMovementVelocity } from '../utils/physics';
import { useMobileControls } from '../contexts/MobileControlsContext';
import { CharacterModel } from './CharacterModel';

export type CharacterState = {
  moveSpeed: number;
  jumpForce: number;
  airControl: number;
  isGrounded: boolean;
  velocity: { x: number; y: number; z: number };
};

type CharacterControllerProps = {
  avatarUrl?: string;
};

export const CharacterController = React.forwardRef<any, CharacterControllerProps>(
  ({ avatarUrl }, ref) => {
    const rigidBody = useRef<RigidBodyApi>(null);
    const modelRef = useRef<THREE.Group>(null);
    const { rapier, world } = useRapier();
    const { isJumping: isMobileJumping, movement: mobileMovement } = useMobileControls();
    const [, getKeys] = useKeyboardControls();
    const [isSprinting, setIsSprinting] = useState(false);
    const [isMoving, setIsMoving] = useState(false);
    const targetRotation = useRef(0);
    const currentRotation = useRef(0);

    const [state, setState] = useState<CharacterState>({
      moveSpeed: 0,
      jumpForce: 0,
      airControl: 0,
      isGrounded: false,
      velocity: { x: 0, y: 0, z: 0 },
    });

    const controls = useCharacterControls();

    useFrame(() => {
      if (!rigidBody.current) return;

      const translation = rigidBody.current.translation();
      const rayLength = 1.5;
      const rayDir = { x: 0, y: -1, z: 0 };

      const rayOffsets = [
        { x: 0, z: 0 },
        { x: 0.3, z: 0 },
        { x: -0.3, z: 0 },
        { x: 0, z: 0.3 },
        { x: 0, z: -0.3 },
      ];

      let isGrounded = false;
      let closestHit: any = null;

      for (const offset of rayOffsets) {
        const ray = new rapier.Ray(
          { x: translation.x + offset.x, y: translation.y, z: translation.z + offset.z },
          rayDir
        );

        const hit = world.castRay(ray, rayLength, true, undefined, undefined, undefined, rigidBody.current);
        if (hit && (!closestHit || hit.toi < closestHit.toi)) {
          closestHit = hit;
          isGrounded = true;
        }
      }

      const input = getKeys();
      const shouldJump = input.jump || isMobileJumping;
      const linvel = rigidBody.current.linvel();

      const horizontalSpeed = Math.sqrt(linvel.x * linvel.x + linvel.z * linvel.z);
      setIsMoving(horizontalSpeed > 0.5);
      setIsSprinting(input.sprint && horizontalSpeed > 0.5);

      if (Math.abs(linvel.x) > 0.1 || Math.abs(linvel.z) > 0.1) {
        targetRotation.current = Math.atan2(linvel.x, linvel.z);

        let angleDiff = targetRotation.current - currentRotation.current;
        if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        else if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        targetRotation.current = currentRotation.current + angleDiff;
      }

      if (modelRef.current) {
        currentRotation.current = MathUtils.lerp(currentRotation.current, targetRotation.current, 0.2);
        modelRef.current.rotation.y = currentRotation.current;
      }

      let movement = calculateMovement(input, controls.moveSpeed);

      if (Math.abs(mobileMovement.x) > 0 || Math.abs(mobileMovement.y) > 0) {
        movement = { sprint: false, normalizedX: mobileMovement.x, normalizedZ: mobileMovement.y };
      }

      if (movement) {
        const sprintMultiplier = movement.sprint ? controls.sprintMultiplier : 1;
        const moveForce = controls.moveSpeed * (isGrounded ? 1 : controls.airControl);

        const velocity = createMovementVelocity(
          movement.normalizedX,
          movement.normalizedZ,
          moveForce * sprintMultiplier,
          linvel.y
        );

        rigidBody.current.setLinvel(velocity, true);
      }

      if (shouldJump && isGrounded) {
        rigidBody.current.setLinvel({ x: linvel.x, y: 0, z: linvel.z }, true);
        rigidBody.current.applyImpulse(createJumpImpulse(controls.jumpForce, { y: linvel.y }), true);
      }

      setState({
        moveSpeed: controls.moveSpeed,
        jumpForce: controls.jumpForce,
        airControl: controls.airControl,
        isGrounded,
        velocity: linvel,
      });
    });

    React.useImperativeHandle(
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
        mass={10}
        position={[0, 6, 1]}
        enabledRotations={[false, false, false]}
        lockRotations
        gravityScale={3}
        friction={controls.friction}
        linearDamping={controls.linearDamping}
        angularDamping={controls.angularDamping}
        restitution={0}
        ccd={true}
        maxCcdSubsteps={2}
        type="dynamic"
      >
        <CapsuleCollider args={[0.8, 0.4]} offset={[0, 1.2, 0]} />
        <group ref={modelRef} position={[0, -1.15, 0]} scale={1.5}>
          <CharacterModel
            isMoving={isMoving}
            isSprinting={isSprinting}
            isGrounded={state.isGrounded}
            avatarUrl={avatarUrl}
          />
        </group>
      </RigidBody>
    );
  }
);
