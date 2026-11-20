import { useEffect, useRef } from 'react';

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => value * value * (3 - 2 * value);
const ease = (value: number) => value < .5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
const cycle = (value: number) => value % 1 <= .5 ? value % 1 * 2 : 2 - value % 1 * 2;
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

/** The pinned image-loading-state y/B dot field, with its visibility and motion guards. */
export function ImageGenerationLoading({ thumbnail: small = false, presentation = 'default' }: {
  thumbnail?: boolean; presentation?: 'default' | 'playground' | 'single' | 'thumbnail';
}) {
  const thumbnail = small || presentation === 'thumbnail';
  const editor = presentation === 'single' || presentation === 'playground';
  const field = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = field.current, surface = canvas.current;
    const context = surface?.getContext('2d');
    if (!node || !surface || !context) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = motion.matches || document.documentElement.dataset.reducedMotion === 'true';
    const random = (from: number, to: number) => mix(from, to, reduced ? .5 : Math.random());
    const duration = (value: number) => value * 1.2 * random(1, 1.35);
    const durations = [4500, 6330, 5600, 5750, 3600, 2400].map(duration);
    const phases = durations.map(() => random(0, 1));
    const bounds = [random(.1, .32), random(.68, .9), random(.1, .32), random(.68, .9),
      random(.68, .9), random(.1, .32), random(.68, .9), random(.1, .32)];
    const sizes = [random(.42, .52), random(.62, .75), random(.5, .62), random(.74, .9)];
    let frame: number | undefined;
    let visible = false, last = 0, started: number | undefined;
    let width = 0, height = 0, dpr = 1, spacing = 12;
    let xPositions: number[] = [], yPositions: number[] = [];
    let color = getComputedStyle(node).color;
    function draw(now: number) {
      frame = undefined;
      if (!visible || document.hidden || !width || !height) return;
      if (!reduced && last && now - last < 1000 / 30) { frame = requestAnimationFrame(draw); return; }
      last = now; started ??= now;
      const time = reduced ? 0 : now - started;
      const progress = (index: number) => cycle(time / durations[index]! + phases[index]!);
      const x1 = mix(bounds[0]!, bounds[1]!, ease(progress(0)));
      const y1 = mix(bounds[2]!, bounds[3]!, smooth(progress(1)));
      const x2 = mix(bounds[4]!, bounds[5]!, ease(progress(2)));
      const y2 = mix(bounds[6]!, bounds[7]!, smooth(progress(3)));
      const size1 = .78 * mix(sizes[0]!, sizes[1]!, smooth(progress(4)));
      const size2 = .78 * mix(sizes[2]!, sizes[3]!, smooth(progress(5)));
      context!.save(); context!.setTransform(dpr, 0, 0, dpr, 0, 0);
      context!.clearRect(0, 0, width, height); context!.fillStyle = color;
      const radius = thumbnail ? .75 : editor ? 1.5 : Math.max(.55, spacing * .08);
      yPositions.forEach((y, row) => {
        const normalY = yPositions.length === 1 ? .5 : row / (yPositions.length - 1);
        xPositions.forEach((x, column) => {
          const normalX = xPositions.length === 1 ? .5 : column / (xPositions.length - 1);
          const alpha = clamp((1 - smooth(clamp(Math.hypot(normalX - x1, normalY - y1) / size1))) * 1.2 +
            (1 - smooth(clamp(Math.hypot(normalX - x2, normalY - y2) / size2))) * .82) ** 1.18;
          if (alpha <= .03) return;
          context!.globalAlpha = alpha; context!.beginPath(); context!.moveTo(x + radius, y);
          context!.arc(x, y, radius, 0, Math.PI * 2); context!.fill();
        });
      });
      context!.restore();
      if (!reduced) frame = requestAnimationFrame(draw);
    }
    function schedule() { if (frame === undefined && visible && !document.hidden) frame = requestAnimationFrame(draw); }
    function measure() {
      const box = node!.getBoundingClientRect();
      width = Math.max(0, Math.floor(box.width)); height = Math.max(0, Math.floor(box.height));
      dpr = Math.max(1, window.devicePixelRatio || 1);
      surface!.width = Math.floor(width * dpr); surface!.height = Math.floor(height * dpr);
      spacing = thumbnail ? 6 : editor ? 14 : Math.max(1, 12 / dpr);
      const columns = Math.max(1, Math.floor(width / spacing)), rows = Math.max(1, Math.floor(height / spacing));
      const offsetX = (width - (columns - 1) * spacing) * .5, offsetY = (height - (rows - 1) * spacing) * .5;
      xPositions = Array.from({ length: columns }, (_, index) => offsetX + index * spacing);
      yPositions = Array.from({ length: rows }, (_, index) => offsetY + index * spacing);
      schedule();
    }
    const resize = new ResizeObserver(measure); resize.observe(node);
    const intersection = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible) schedule(); else if (frame !== undefined) { cancelAnimationFrame(frame); frame = undefined; }
    });
    intersection.observe(node);
    const preferences = () => {
      reduced = motion.matches || document.documentElement.dataset.reducedMotion === 'true';
      color = getComputedStyle(node!).color; schedule();
    };
    const theme = new MutationObserver(preferences);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-reduced-motion'] });
    motion.addEventListener('change', preferences);
    document.addEventListener('visibilitychange', schedule);
    measure();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      resize.disconnect(); intersection.disconnect(); theme.disconnect();
      motion.removeEventListener('change', preferences); document.removeEventListener('visibilitychange', schedule);
    };
  }, [thumbnail, editor]);
  return <div className="yard-source-image-generation-loading" aria-busy="true" aria-label="Generating image...">
    <div className="yard-source-image-generation-dots" ref={field}><canvas ref={canvas} aria-hidden="true" /></div>
  </div>;
}
