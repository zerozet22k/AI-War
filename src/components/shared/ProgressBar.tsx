export interface ProgressBarProps {
  ratio: number; // 0..1
  color?: string;
  height?: number;
}

export function ProgressBar({ ratio, color = '#3b82f6', height = 6 }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, ratio));
  return (
    <div style={{ background: '#0f1520', borderRadius: 999, height, overflow: 'hidden', border: '1px solid #2a3446' }}>
      <div style={{ width: `${clamped * 100}%`, height: '100%', background: color, transition: 'width 0.15s linear' }} />
    </div>
  );
}
