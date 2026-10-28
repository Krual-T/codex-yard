import { useEffect, useState } from 'react';
import { petFrame } from './model.ts';
import type { PetMotion, PetOption } from './model.ts';

export function PetSprite({ pet, motion }: { pet: PetOption; motion: PetMotion }) {
  const [step, setStep] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    setStep(0);
    if (reducedMotion) return;
    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => { timer = setTimeout(() => { setStep(++index); advance(); }, petFrame(motion, index).duration); };
    advance();
    return () => clearTimeout(timer);
  }, [motion, reducedMotion, pet.id]);
  if (!pet.src) return <span className="yard-mini-missing" aria-hidden="true">{pet.name}</span>;
  const frame = petFrame(motion, reducedMotion ? 0 : step);
  return <span aria-hidden="true" className="yard-mini-sprite" data-codex-pet-id={pet.id} data-codex-pet-state={motion}
    style={{ backgroundImage: `url(${JSON.stringify(pet.src)})`, backgroundSize: `800% ${pet.rows * 100}%`,
      backgroundPosition: `${frame.column / 7 * 100}% ${frame.row / (pet.rows - 1) * 100}%` }} />;
}
