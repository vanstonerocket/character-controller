// App.tsx

import React from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { KeyboardControls, Environment } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { Bolt } from 'lucide-react';
import {
  EffectComposer,
  Bloom,
  ChromaticAberration,
  Vignette,
  SMAA,
  BrightnessContrast,
  HueSaturation,
  DepthOfField
} from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { CharacterController } from './components/CharacterController';
import { Ground } from './components/Ground';
import { FollowCamera } from './components/FollowCamera';
import { useCharacterControls } from './hooks/useCharacterControls';
import { useCameraControls } from './hooks/useCameraControls';
import { useLightingControls } from './hooks/useLightingControls';
import { usePostProcessingControls } from './hooks/usePostProcessingControls';
import { Leva } from 'leva';
import { MobileControlsProvider } from './contexts/MobileControlsContext';
import { MobileControls } from './components/MobileControls';

const characterRef = { current: null };

// ---- Ready Player Me constants ----
const RPM_SUBDOMAIN = 'foundingup';
const RPM_IFRAME_ORIGIN = `https://${RPM_SUBDOMAIN}.readyplayer.me`;
const RPM_IFRAME_URL = `${RPM_IFRAME_ORIGIN}/avatar?frameApi`;

type RpmMessage =
  | { source: 'readyplayerme'; eventName: 'v1.frame.ready' }
  | { source: 'readyplayerme'; eventName: 'v1.avatar.exported'; data: { url: string } }
  | { source: 'readyplayerme'; eventName: string; data?: unknown };

function DynamicDepthOfField({
  enabled,
  target,
  focalLength,
  bokehScale
}: {
  enabled: boolean;
  target: { current: any };
  focalLength: number;
  bokehScale: number;
}) {
  const { camera } = useThree();
  const [focusDistance, setFocusDistance] = React.useState(0);

  useFrame(() => {
    if (!enabled || !target.current) return;
    const distance = camera.position.distanceTo(target.current.position.clone());
    setFocusDistance(Math.min(distance / 20, 1));
  });

  return enabled ? (
    <DepthOfField
      focusDistance={focusDistance}
      focalLength={focalLength}
      bokehScale={bokehScale}
      height={1080}
    />
  ) : null;
}

function App() {
  useCharacterControls();
  useCameraControls();
  const lighting = useLightingControls();
  const postProcessing = usePostProcessingControls();

  // ---- Ready Player Me UI state ----
  const [isAvatarModalOpen, setIsAvatarModalOpen] = React.useState(false);
  const [avatarUrlFromRpm, setAvatarUrlFromRpm] = React.useState<string | undefined>(undefined);
  const rpmFrameRef = React.useRef<HTMLIFrameElement | null>(null);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== RPM_IFRAME_ORIGIN) return;

      let json: RpmMessage | null = null;
      try {
        json = JSON.parse(event.data as string) as RpmMessage;
      } catch {
        return;
      }

      if (!json || (json as any).source !== 'readyplayerme') return;

      if (json.eventName === 'v1.frame.ready') {
        rpmFrameRef.current?.contentWindow?.postMessage(
          JSON.stringify({
            target: 'readyplayerme',
            type: 'subscribe',
            eventName: 'v1.**'
          }),
          RPM_IFRAME_ORIGIN
        );
      }

      if (json.eventName === 'v1.avatar.exported') {
        const url = (json as Extract<RpmMessage, { eventName: 'v1.avatar.exported' }>).data.url;

        // Ensure GLB if RPM returns a base URL (some configs do)
        const glbUrl = url.endsWith('.glb') || url.includes('.glb?') ? url : `${url}.glb`;

        setAvatarUrlFromRpm(glbUrl);
        setIsAvatarModalOpen(false);
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="w-full h-screen">
      <Bolt className="fixed top-4 right-4 w-6 h-6 text-white opacity-50" />

      <div className="fixed top-4 left-1/2 -translate-x-1/2 text-white font-mono text-sm pointer-events-none select-none bg-white/30 px-4 py-2 rounded-lg backdrop-blur-sm z-50">
        WASD to move | SPACE to jump | SHIFT to run
      </div>

      {/* ---- Customize Avatar button ---- */}
      <div className="fixed top-4 left-4 z-50 flex items-center gap-3">
        <button
          className="px-4 py-2 rounded-lg bg-white/20 text-white backdrop-blur-sm hover:bg-white/30 transition"
          onClick={() => setIsAvatarModalOpen(true)}
        >
          Customize Avatar
        </button>

        {avatarUrlFromRpm ? (
          <a
            className="text-white/90 text-sm underline underline-offset-4"
            href={avatarUrlFromRpm}
            target="_blank"
            rel="noreferrer"
            title="Open exported avatar URL"
          >
            Avatar ready
          </a>
        ) : null}
      </div>

      {/* ---- Modal with Ready Player Me iframe ---- */}
      {isAvatarModalOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70">
          <div className="w-[min(1000px,92vw)] h-[min(720px,86vh)] bg-neutral-900 rounded-2xl overflow-hidden shadow-2xl border border-white/10 relative">
            <div className="absolute top-3 right-3 z-10 flex gap-2">
              <button
                className="px-3 py-1 rounded-md bg-white/10 text-white hover:bg-white/20 transition"
                onClick={() => setIsAvatarModalOpen(false)}
              >
                Close
              </button>
            </div>

            <iframe
              ref={rpmFrameRef}
              src={RPM_IFRAME_URL}
              title="Ready Player Me Avatar Creator"
              className="w-full h-full"
              allow="camera *; microphone *; clipboard-write"
            />
          </div>
        </div>
      ) : null}

      <Leva collapsed />
      <MobileControlsProvider>
        <MobileControls />
        <KeyboardControls
          map={[
            { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
            { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
            { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
            { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
            { name: 'jump', keys: ['Space'] },
            { name: 'sprint', keys: ['ShiftLeft', 'ShiftRight'] }
          ]}
        >
          <Canvas shadows>
            <Environment preset="sunset" intensity={1} background blur={0.8} resolution={256} />
            <ambientLight intensity={lighting.ambientIntensity} />
            <directionalLight
              castShadow
              position={[
                lighting.directionalDistance,
                lighting.directionalHeight,
                lighting.directionalDistance / 2
              ]}
              intensity={lighting.directionalIntensity}
              shadow-mapSize={[4096, 4096]}
              shadow-camera-left={-30}
              shadow-camera-right={30}
              shadow-camera-top={30}
              shadow-camera-bottom={-30}
              shadow-camera-far={50}
              shadow-bias={-0.0001}
              shadow-normalBias={0.02}
            />
            <Physics interpolate={false} positionIterations={5} velocityIterations={4}>
              <CharacterController ref={characterRef} avatarUrl={avatarUrlFromRpm} />
              <Ground />
            </Physics>
            <FollowCamera target={characterRef} />
            <EffectComposer>
              <DynamicDepthOfField
                enabled={postProcessing.depthOfFieldEnabled}
                target={characterRef}
                focalLength={postProcessing.focalLength}
                bokehScale={postProcessing.bokehScale}
              />
              {postProcessing.bloomEnabled ? <Bloom intensity={postProcessing.bloomIntensity} /> : null}
              {postProcessing.chromaticAberrationEnabled ? (
                <ChromaticAberration
                  offset={[
                    postProcessing.chromaticAberrationOffset,
                    postProcessing.chromaticAberrationOffset
                  ]}
                  blendFunction={BlendFunction.NORMAL}
                />
              ) : null}
              {postProcessing.vignetteEnabled ? (
                <Vignette
                  darkness={postProcessing.vignetteDarkness}
                  offset={postProcessing.vignetteOffset}
                  blendFunction={BlendFunction.NORMAL}
                />
              ) : null}
              {postProcessing.brightnessContrastEnabled ? (
                <BrightnessContrast
                  brightness={postProcessing.brightness}
                  contrast={postProcessing.contrast}
                  blendFunction={BlendFunction.NORMAL}
                />
              ) : null}
              {postProcessing.hueSaturationEnabled ? (
                <HueSaturation
                  hue={postProcessing.hue}
                  saturation={postProcessing.saturation}
                  blendFunction={BlendFunction.NORMAL}
                />
              ) : null}
              <SMAA />
            </EffectComposer>
          </Canvas>
        </KeyboardControls>
      </MobileControlsProvider>
    </div>
  );
}

export default App;
