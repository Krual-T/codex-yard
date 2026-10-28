import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { petFrame, petFrameCount } from './model.ts';
import type { PetMotion, PetOption } from './model.ts';

const motionListeners = new Set<() => void>();
let motionQuery: MediaQueryList | undefined;
let motionObserver: MutationObserver | undefined;

function systemMotion() {
  return motionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)');
}

function reducedMotionSnapshot() {
  const resolved = document.documentElement.dataset.reducedMotion;
  if (resolved === 'true') return true;
  if (resolved === 'false') return false;
  return systemMotion().matches;
}

function notifyMotion() { for (const listener of motionListeners) listener(); }

function subscribeMotion(listener: () => void) {
  motionListeners.add(listener);
  if (motionListeners.size === 1) {
    systemMotion().addEventListener('change', notifyMotion);
    motionObserver = new MutationObserver(notifyMotion);
    motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] });
  }
  return () => {
    motionListeners.delete(listener);
    if (motionListeners.size === 0) {
      systemMotion().removeEventListener('change', notifyMotion);
      motionObserver?.disconnect();
      motionObserver = undefined;
    }
  };
}

function subscribeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

export function PetSprite({ pet, motion }: { pet: PetOption; motion: PetMotion }) {
  const [playback, setPlayback] = useState<{ motion: PetMotion; step: number }>({ motion, step: 0 });
  const current = useRef(playback);
  const reducedMotion = useSyncExternalStore(subscribeMotion, reducedMotionSnapshot, () => false);
  const visible = useSyncExternalStore(subscribeVisibility, () => document.visibilityState !== 'hidden', () => true);
  useEffect(() => {
    current.current = { motion, step: 0 };
    setPlayback(current.current);
  }, [motion, pet.id, pet.src]);
  useEffect(() => {
    if (reducedMotion || reducedMotionSnapshot() || !visible || !pet.src) return;
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => { timer = setTimeout(() => {
      if (reducedMotionSnapshot() || document.visibilityState === 'hidden') return;
      const previous = current.current;
      const step = previous.step + 1;
      current.current = previous.motion !== 'idle' && step >= petFrameCount(previous.motion) * 3
        ? { motion: 'idle', step: 0 } : { ...previous, step };
      setPlayback(current.current);
      advance();
    }, petFrame(current.current.motion, current.current.step).duration); };
    advance();
    return () => clearTimeout(timer);
  }, [motion, reducedMotion, visible, pet.id, pet.src]);
  if (!pet.src) return <span className="yard-mini-missing" aria-hidden="true">{pet.name}</span>;
  const frame = petFrame(playback.motion, reducedMotion ? 0 : playback.step);
  return <span aria-hidden="true" className="yard-mini-sprite" data-codex-pet-id={pet.id} data-codex-pet-state={playback.motion}
    style={{ backgroundImage: `url(${JSON.stringify(pet.src)})`, backgroundSize: `800% ${pet.rows * 100}%`,
      backgroundPosition: `${frame.column / 7 * 100}% ${frame.row / (pet.rows - 1) * 100}%` }} />;
}
