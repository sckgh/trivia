import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

interface Props {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Largest font size in SVG units (1 unit = 1/1920 of the screen width). */
  max: number;
  min?: number;
  className?: string;
  align?: 'left' | 'center' | 'right';
  children: ComponentChildren;
  /** Changes when the content changes, to re-measure. */
  fitKey: string;
}

/**
 * Wrapping text inside the SVG that shrinks until it fits its box.
 * Uses <foreignObject> so long prompts wrap naturally and stay vector-sharp at any resolution.
 */
export function FitText({ x, y, width, height, max, min = 18, className = '', align = 'center', children, fitKey }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(max);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let s = max;
    el.style.fontSize = `${s}px`;
    while (s > min && (el.scrollHeight > height + 1 || el.scrollWidth > width + 1)) {
      s = Math.max(min, Math.floor(s * 0.92));
      el.style.fontSize = `${s}px`;
    }
    setSize(s);
  }, [fitKey, max, min, width, height]);

  return (
    <foreignObject x={x} y={y} width={width} height={height}>
      <div
        ref={ref}
        class={`fit ${className}`}
        style={{ width: `${width}px`, height: `${height}px`, fontSize: `${size}px`, textAlign: align, alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' }}
      >
        <div class="fit-inner">{children}</div>
      </div>
    </foreignObject>
  );
}
