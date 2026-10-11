import React from "react";
import { Easing, interpolate } from "remotion";
import { C } from "./theme";
import type { Expression, Pose } from "./types";

/**
 * "Tapu", the explainer mascot: a 2D clay-style character drawn in SVG with the app's ink outlines.
 * Everything is a pure function of the frame, so renders are deterministic:
 *  - mouth opens with the narration's loudness (amp, 0..1),
 *  - idle motion: blinking, head bob, breathing, antenna glow while talking,
 *  - arms (rubber-hose, two segments) blend from the previous scene's pose into this one.
 */

type Arm = { up: number; bend: number };
type PoseDef = { l: Arm; r: Arm; lean: number; gaze: [number, number]; finger?: boolean };

const POSES: Record<Pose, PoseDef> = {
  explaining: { l: { up: 22, bend: 30 }, r: { up: 48, bend: 62 }, lean: 0, gaze: [0, 0] },
  pointing: { l: { up: 16, bend: 18 }, r: { up: 96, bend: 4 }, lean: 4, gaze: [10, -2], finger: true },
  thinking: { l: { up: 26, bend: -128 }, r: { up: 14, bend: 10 }, lean: -3, gaze: [-7, -9] },
  excited: { l: { up: 145, bend: 12 }, r: { up: 145, bend: 12 }, lean: 0, gaze: [0, -3] },
  concluding: { l: { up: 20, bend: 24 }, r: { up: 128, bend: 24 }, lean: 2, gaze: [4, 0] },
};

const SHOULDER_L: [number, number] = [128, 392];
const SHOULDER_R: [number, number] = [392, 392];
const UPPER = 78;
const FORE = 70;

const rad = (d: number) => (d * Math.PI) / 180;
/** Direction of a limb rotated `deg` away from straight down; side -1 = character's left (screen left). */
const dir = (deg: number, side: -1 | 1): [number, number] => [side * Math.sin(rad(deg)), Math.cos(rad(deg))];

function Limb({ shoulder, arm, side, finger }: { shoulder: [number, number]; arm: Arm; side: -1 | 1; finger: boolean }) {
  const [sx, sy] = shoulder;
  const d1 = dir(arm.up, side);
  const ex = sx + d1[0] * UPPER;
  const ey = sy + d1[1] * UPPER;
  const d2 = dir(arm.up + arm.bend, side);
  const hx = ex + d2[0] * FORE;
  const hy = ey + d2[1] * FORE;
  // Rubber-hose arm: the elbow is the control point of one smooth curve.
  const path = `M ${sx} ${sy} Q ${ex} ${ey} ${hx} ${hy}`;
  return (
    <g>
      <path d={path} stroke={C.ink} strokeWidth={36} strokeLinecap="round" fill="none" />
      <path d={path} stroke={C.lavender} strokeWidth={22} strokeLinecap="round" fill="none" />
      {finger && (
        <g>
          <line x1={hx} y1={hy} x2={hx + d2[0] * 34} y2={hy + d2[1] * 34} stroke={C.ink} strokeWidth={20} strokeLinecap="round" />
          <line x1={hx} y1={hy} x2={hx + d2[0] * 34} y2={hy + d2[1] * 34} stroke={C.lavender} strokeWidth={8} strokeLinecap="round" />
        </g>
      )}
      <circle cx={hx} cy={hy} r={22} fill={C.lavender} stroke={C.ink} strokeWidth={6} />
    </g>
  );
}

const mixArm = (a: Arm, b: Arm, t: number): Arm => ({ up: a.up + (b.up - a.up) * t, bend: a.bend + (b.bend - a.bend) * t });

/** Blink roughly every 3-4 s at deterministic, slightly irregular times. */
function blink(frame: number): number {
  const period = 104;
  const k = Math.floor(frame / period);
  const offset = (k * 37) % 29; // irregular spacing
  const local = frame - k * period - offset;
  if (local < 0 || local > 7) return 1;
  return interpolate(local, [0, 3, 4, 7], [1, 0.08, 0.08, 1]);
}

function Brows({ expression, lift }: { expression: Expression; lift: number }) {
  const y = 226 - lift;
  const s = { stroke: C.ink, strokeWidth: 7, strokeLinecap: "round" as const, fill: "none" };
  switch (expression) {
    case "curious":
      return (<g><path d={`M 182 ${y - 14} Q 208 ${y - 32} 236 ${y - 16}`} {...s} /><path d={`M 286 ${y} L 336 ${y - 4}`} {...s} /></g>);
    case "focused":
      return (<g><path d={`M 184 ${y - 6} L 234 ${y + 4}`} {...s} /><path d={`M 286 ${y + 4} L 336 ${y - 6}`} {...s} /></g>);
    case "surprised":
      return (<g><path d={`M 182 ${y - 16} Q 208 ${y - 36} 236 ${y - 18}`} {...s} /><path d={`M 284 ${y - 18} Q 312 ${y - 36} 338 ${y - 16}`} {...s} /></g>);
    default:
      return (<g><path d={`M 184 ${y - 4} Q 208 ${y - 18} 234 ${y - 6}`} {...s} /><path d={`M 286 ${y - 6} Q 312 ${y - 18} 336 ${y - 4}`} {...s} /></g>);
  }
}

function Eye({ cx, cy, open, gaze, happy, big }: { cx: number; cy: number; open: number; gaze: [number, number]; happy: boolean; big: boolean }) {
  if (happy) {
    return <path d={`M ${cx - 26} ${cy + 6} Q ${cx} ${cy - 24} ${cx + 26} ${cy + 6}`} stroke={C.ink} strokeWidth={8} strokeLinecap="round" fill="none" />;
  }
  const rx = big ? 37 : 33;
  const ry = big ? 42 : 38;
  return (
    <g transform={`translate(${cx} ${cy}) scale(1 ${open}) translate(${-cx} ${-cy})`}>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={C.white} stroke={C.ink} strokeWidth={6} />
      <circle cx={cx + gaze[0]} cy={cy + 4 + gaze[1]} r={big ? 14 : 16} fill={C.ink} />
      <circle cx={cx + gaze[0] + 6} cy={cy - 3 + gaze[1]} r={5.5} fill={C.white} />
    </g>
  );
}

function Mouth({ amp, expression }: { amp: number; expression: Expression }) {
  const cx = 260;
  const top = 344;
  if (amp < 0.06) {
    if (expression === "surprised") return <ellipse cx={cx} cy={top + 6} rx={11} ry={13} fill={C.ink} />;
    const w = expression === "proud" || expression === "happy" ? 30 : 24;
    const dip = expression === "focused" ? 8 : 18;
    return <path d={`M ${cx - w} ${top} Q ${cx} ${top + dip} ${cx + w} ${top}`} stroke={C.ink} strokeWidth={7} strokeLinecap="round" fill="none" />;
  }
  const w = 22 + 10 * amp;
  const h = 8 + 30 * amp;
  const d = `M ${cx - w} ${top} Q ${cx} ${top - 4} ${cx + w} ${top} Q ${cx + w * 0.9} ${top + h * 1.25} ${cx} ${top + h * 1.3} Q ${cx - w * 0.9} ${top + h * 1.25} ${cx - w} ${top} Z`;
  return (
    <g>
      <clipPath id="mouth-clip"><path d={d} /></clipPath>
      <path d={d} fill={C.ink} stroke={C.ink} strokeWidth={6} strokeLinejoin="round" />
      <ellipse cx={cx} cy={top + h * 1.25} rx={w * 0.55} ry={h * 0.45} fill="#f08a6c" clipPath="url(#mouth-clip)" />
    </g>
  );
}

export function Mascot({ pose, prevPose, expression, sceneFrame, frame, amp, fps }: {
  pose: Pose; prevPose: Pose; expression: Expression; sceneFrame: number; frame: number; amp: number; fps: number;
}) {
  const t = interpolate(sceneFrame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
  const a = POSES[prevPose];
  const b = POSES[pose];
  const sec = frame / fps;

  let l = mixArm(a.l, b.l, t);
  let r = mixArm(a.r, b.r, t);
  // Gestures on top of the pose, driven by time and by speech.
  if (pose === "explaining") r = { up: r.up + Math.sin(sec * 2.6) * 10 * (0.4 + amp), bend: r.bend + Math.sin(sec * 3.1) * 12 * amp };
  if (pose === "concluding") r = { up: r.up, bend: r.bend + Math.sin(sec * 7) * 22 };
  if (pose === "excited") {
    l = { up: l.up + Math.sin(sec * 6) * 8, bend: l.bend };
    r = { up: r.up + Math.sin(sec * 6 + 1.5) * 8, bend: r.bend };
  }
  if (pose === "pointing") r = { up: r.up + Math.sin(sec * 3) * 2, bend: r.bend };

  const lean = a.lean + (b.lean - a.lean) * t;
  const gaze: [number, number] = [a.gaze[0] + (b.gaze[0] - a.gaze[0]) * t, a.gaze[1] + (b.gaze[1] - a.gaze[1]) * t];
  const bob = Math.sin(sec * Math.PI * 0.9) * 6 + (pose === "excited" ? -Math.abs(Math.sin(sec * 6)) * 14 : 0) - amp * 5;
  const breathe = 1 + Math.sin(sec * Math.PI * 0.6) * 0.012;
  const open = blink(frame);
  const happyEyes = expression === "proud" && open > 0.5;
  const browLift = expression === "surprised" ? 6 : amp * 4;

  return (
    <svg viewBox="0 0 520 640" width="100%" height="100%" style={{ overflow: "visible" }}>
      <ellipse cx={260} cy={606} rx={140 - bob} ry={16} fill={C.ink} opacity={0.12} />
      <g transform={`translate(0 ${bob}) rotate(${lean} 260 560)`}>
        {/* feet */}
        <ellipse cx={200} cy={572} rx={44} ry={22} fill={C.lavender} stroke={C.ink} strokeWidth={6} />
        <ellipse cx={320} cy={572} rx={44} ry={22} fill={C.lavender} stroke={C.ink} strokeWidth={6} />
        <g transform={`translate(260 568) scale(1 ${breathe}) translate(-260 -568)`}>
          {/* antenna */}
          <line x1={260} y1={156} x2={260} y2={98} stroke={C.ink} strokeWidth={7} strokeLinecap="round" />
          <circle cx={260} cy={86} r={26 + amp * 10} fill={C.sun} opacity={0.25 + amp * 0.5} />
          <circle cx={260} cy={86} r={18} fill={C.sun} stroke={C.ink} strokeWidth={6} />
          {/* body */}
          <path d="M260 152 C 364 152 412 232 412 334 L 412 470 C 412 538 360 568 260 568 C 160 568 108 538 108 470 L 108 334 C 108 232 156 152 260 152 Z"
            fill={C.lavender} stroke={C.ink} strokeWidth={7} />
          <ellipse cx={260} cy={478} rx={98} ry={66} fill={C.lavenderSoft} />
          <ellipse cx={178} cy={214} rx={34} ry={16} fill={C.white} opacity={0.55} transform="rotate(-32 178 214)" />
          {/* bow tie: a small scholarly touch */}
          <path d="M260 404 L 226 388 L 226 420 Z M260 404 L 294 388 L 294 420 Z" fill={C.coral} stroke={C.ink} strokeWidth={5} strokeLinejoin="round" />
          <circle cx={260} cy={404} r={8} fill={C.coral} stroke={C.ink} strokeWidth={5} />
          {/* face */}
          <ellipse cx={176} cy={328} rx={22} ry={13} fill={C.pink} />
          <ellipse cx={344} cy={328} rx={22} ry={13} fill={C.pink} />
          <Eye cx={208} cy={282} open={open} gaze={gaze} happy={happyEyes} big={expression === "surprised"} />
          <Eye cx={312} cy={282} open={open} gaze={gaze} happy={happyEyes} big={expression === "surprised"} />
          <Brows expression={expression} lift={browLift} />
          <Mouth amp={amp} expression={expression} />
        </g>
        <Limb shoulder={SHOULDER_L} arm={l} side={-1} finger={false} />
        <Limb shoulder={SHOULDER_R} arm={r} side={1} finger={!!b.finger && t > 0.5} />
      </g>
    </svg>
  );
}
