import { useEffect, useState, useSyncExternalStore } from 'react';
import { petFrame } from './model.ts';
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

export function PetSprite({ pet, motion }: { pet: PetOption; motion: PetMotion }) {
  const [step, setStep] = useState(0);
  const reducedMotion = useSyncExternalStore(subscribeMotion, reducedMotionSnapshot, () => false);
  useEffect(() => {
    setStep(0);
    if (reducedMotion || reducedMotionSnapshot() || !pet.src) return;
    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => { timer = setTimeout(() => {
      if (reducedMotionSnapshot()) { setStep(0); return; }
      setStep(++index); advance();
    }, petFrame(motion, index).duration); };
    advance();
    return () => clearTimeout(timer);
  }, [motion, reducedMotion, pet.id, pet.src]);
  if (!pet.src) return <span className="yard-mini-missing" aria-hidden="true">{pet.name}</span>;
  const frame = petFrame(motion, reducedMotion ? 0 : step);
  return <span aria-hidden="true" className="yard-mini-sprite" data-codex-pet-id={pet.id} data-codex-pet-state={motion}
    style={{ backgroundImage: `url(${JSON.stringify(pet.src)})`, backgroundSize: `800% ${pet.rows * 100}%`,
      backgroundPosition: `${frame.column / 7 * 100}% ${frame.row / (pet.rows - 1) * 100}%` }} />;
}
