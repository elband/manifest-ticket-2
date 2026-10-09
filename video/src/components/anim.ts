import type { CSSProperties } from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig, type SpringConfig } from "remotion";

/** Progres spring 0→1 yang mulai pada `delay` (frame relatif scene). */
export const useEnter = (delay: number, config: Partial<SpringConfig> = {}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 15, mass: 0.8, stiffness: 120, ...config } });
};

/** Interpolasi dengan clamp di kedua sisi dan easing halus. */
export const tween = (
  frame: number,
  input: [number, number],
  output: [number, number],
  easing: (t: number) => number = Easing.bezier(0.33, 1, 0.68, 1),
) => interpolate(frame, input, output, { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });

export const fadeUp = (p: number, dist = 40): CSSProperties => ({
  opacity: Math.min(1, Math.max(0, p * 1.4)),
  transform: `translateY(${(1 - p) * dist}px)`,
});

export const popIn = (p: number): CSSProperties => ({
  opacity: Math.min(1, Math.max(0, p * 2)),
  transform: `scale(${0.6 + 0.4 * p})`,
});
