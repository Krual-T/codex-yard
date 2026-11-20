import { useEffect, useRef } from 'react';

// The fixed renderer's CSS module in app-initial-e7c27dd40beb.css supplies
// the mask and keyframes. Match its visibility gate and sweep cadence.
export function ActivityShimmer({ text, active = true }: { text: string; active?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    const root = document.documentElement;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const sweep = '_cadencedShimmerActive_wne66_71';
    let visible = false, playing = false;
    let first = 0, interval = 0, end = 0;
    const stop = () => {
      playing = false;
      clearTimeout(first);
      clearInterval(interval);
      clearTimeout(end);
      element.classList.remove(sweep);
    };
    const scan = () => {
      element.classList.add(sweep);
      end = window.setTimeout(() => element.classList.remove(sweep), 1000);
    };
    const sync = () => {
      const reduced = root.dataset.reducedMotion == null ? motion.matches : root.dataset.reducedMotion === 'true';
      const play = visible && !document.hidden && !reduced;
      if (play === playing) return;
      if (!play) { stop(); return; }
      playing = true;
      first = window.setTimeout(() => { scan(); interval = window.setInterval(scan, 4000); }, 600);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = !!entry?.isIntersecting; sync(); });
    observer.observe(element);
    const preferences = new MutationObserver(sync);
    preferences.observe(root, { attributes: true, attributeFilter: ['data-reduced-motion'] });
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      stop();
      observer.disconnect();
      preferences.disconnect();
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [active]);
  return active ? <span ref={ref} className="relative inline-block align-top _cadencedShimmer_wne66_2">
    {text}<span aria-hidden="true" className="_cadencedShimmerSweep_wne66_35">
      <span className="_cadencedShimmerHighlight_wne66_30">{text}</span>
    </span>
  </span> : <span>{text}</span>;
}
