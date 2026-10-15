import { useEffect, useRef } from 'preact/hooks';
import type { MediaDef } from '../../shared/schema';

export function mediaUrl(src: string): string {
  return /^https?:\/\//.test(src) ? src : `/media/${src}`;
}

interface Props {
  media: MediaDef;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Image reveal progress (0 = fully hidden effect). */
  step: number;
  revealed: boolean;
  /** Host media command; reacts whenever `seq` changes. */
  command: { action: 'play' | 'pause' | 'restart'; seq: number } | null;
  playing: boolean;
  onPlaying: (playing: boolean) => void;
}

/** Image / audio / video inside the SVG stage, controlled remotely by the host. */
export function Media({ media, x, y, width, height, step, revealed, command, playing, onPlaying }: Props) {
  const el = useRef<HTMLMediaElement | null>(null);
  const start = media.start ?? 0;

  useEffect(() => {
    const m = el.current;
    if (!m || !command) return;
    if (command.action === 'pause') m.pause();
    else {
      if (command.action === 'restart' || m.ended || (media.end !== undefined && m.currentTime >= media.end)) {
        m.currentTime = start;
      }
      m.play().catch(() => onPlaying(false));
    }
  }, [command?.seq]);

  useEffect(() => {
    const m = el.current;
    if (m) m.currentTime = start;
  }, [media.src]);

  const onTime = () => {
    const m = el.current;
    if (m && media.end !== undefined && m.currentTime >= media.end) m.pause();
  };
  const handlers = {
    onPlay: () => onPlaying(true),
    onPause: () => onPlaying(false),
    onEnded: () => onPlaying(false),
    onTimeUpdate: onTime,
    preload: 'auto' as const,
  };

  if (media.type === 'image') {
    const steps = media.steps ?? 4;
    const remaining = revealed ? 0 : Math.max(0, 1 - step / steps);
    const style: Record<string, string> = {};
    if (media.reveal === 'blur') style.filter = `blur(${Math.round(60 * remaining)}px)`;
    if (media.reveal === 'zoom') style.transform = `scale(${1 + 5 * remaining})`;
    return (
      <foreignObject x={x} y={y} width={width} height={height}>
        <div class="media-frame" style={{ width: `${width}px`, height: `${height}px` }}>
          <img src={mediaUrl(media.src)} alt={media.alt ?? ''} style={style} />
        </div>
      </foreignObject>
    );
  }

  if (media.type === 'video') {
    return (
      <foreignObject x={x} y={y} width={width} height={height}>
        <div class="media-frame" style={{ width: `${width}px`, height: `${height}px` }}>
          <video ref={(v) => { el.current = v; }} src={`${mediaUrl(media.src)}#t=${start}`} playsInline {...handlers} />
        </div>
      </foreignObject>
    );
  }

  // Audio: an animated equaliser so the room can see something is playing.
  const bars = 9;
  const bw = Math.min(60, width / (bars * 1.6));
  const cx = x + width / 2;
  return (
    <g>
      <foreignObject x={0} y={0} width={1} height={1}>
        <audio ref={(a) => { el.current = a; }} src={mediaUrl(media.src)} {...handlers} />
      </foreignObject>
      <g class={`eq ${playing ? 'playing' : ''}`}>
        {Array.from({ length: bars }, (_, i) => (
          <rect
            x={cx + (i - bars / 2) * bw * 1.6}
            y={y + height * 0.15}
            width={bw}
            height={height * 0.7}
            rx={bw / 2}
            style={{ animationDelay: `${(i * 137) % 600}ms`, transformOrigin: `0 ${y + height / 2}px` }}
          />
        ))}
      </g>
      {!playing && (
        <text x={cx} y={y + height / 2 + 30} class="eq-label" text-anchor="middle">
          ♪
        </text>
      )}
    </g>
  );
}
