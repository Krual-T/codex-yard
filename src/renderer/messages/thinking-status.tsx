/** @jsxRuntime classic */
import type { ComponentType, ReactNode } from 'react';

export type ThinkingStatusSlotProps = { children?: ReactNode; isActive: boolean };
export type ThinkingStatusSlotDependencies = {
  useReducedMotion: () => boolean;
  AnimatePresence: ComponentType<{ children?: ReactNode }>;
  MotionDiv: ComponentType<{ children?: ReactNode; animate: { opacity: number }; exit: { opacity: number }; initial: { opacity: number }; transition: object }>;
  transition: object;
};

export function createThinkingStatusSlotComponent(React: typeof import('react'), dependencies: ThinkingStatusSlotDependencies): ComponentType<ThinkingStatusSlotProps> {
  const { useReducedMotion, AnimatePresence, MotionDiv, transition } = dependencies;
  return function ThinkingStatusSlot({ children, isActive }: ThinkingStatusSlotProps) {
    const reducedMotion = useReducedMotion();
    return <div aria-hidden={!isActive} className="h-9 overflow-hidden">
      {reducedMotion ? (isActive ? children : null) : <AnimatePresence>{isActive ? <MotionDiv key="thinking-status"
        animate={{ opacity: 1 }} exit={{ opacity: 0 }} initial={{ opacity: 0 }} transition={transition}>{children}</MotionDiv> : null}</AnimatePresence>}
    </div>;
  };
}
