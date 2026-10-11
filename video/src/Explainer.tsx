import React from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { AbsoluteFill, Html5Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Mascot } from "./Mascot";
import { C, display, kindTone, popShadow, sans } from "./theme";
import type { ExplainerProps, Point, Scene } from "./types";

/** Start frame of every scene (scenes play back to back; each lasts exactly as long as its voice clip). */
export function sceneStarts(scenes: Scene[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (const s of scenes) {
    out.push(at);
    at += s.durationInFrames;
  }
  return out;
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Spring-in for an element that appears at frame `at` of the scene. */
function useEnter(at: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - at, fps, config: { damping: 16, stiffness: 140, mass: 0.7 } });
  return { p, style: { opacity: interpolate(p, [0, 0.6], [0, 1], clamp), transform: `translateY(${(1 - p) * 26}px) scale(${0.96 + p * 0.04})` } };
}

function Kicker({ scene, index, total }: { scene: Scene; index: number; total: number }) {
  const tone = kindTone[scene.kind] ?? { bg: C.lavenderSoft, fg: C.purpleDeep };
  const { style } = useEnter(0);
  return (
    <div style={{ ...style, display: "inline-flex", alignItems: "center", gap: 14, alignSelf: "flex-start" }}>
      <span style={{ background: tone.bg, color: tone.fg, border: `3px solid ${C.ink}`, borderRadius: 999, padding: "8px 22px", fontFamily: sans, fontWeight: 700,
        fontSize: 22, letterSpacing: "0.14em", textTransform: "uppercase", boxShadow: popShadow(3), transform: "rotate(-1.5deg)", display: "inline-block" }}>
        {scene.kicker}
      </span>
      <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 20, color: C.muted }}>{index + 1} / {total}</span>
    </div>
  );
}

function Highlighter({ at, width }: { at: number; width: string }) {
  const frame = useCurrentFrame();
  const w = interpolate(frame - at, [6, 22], [0, 1], clamp);
  return <span style={{ position: "absolute", left: 0, bottom: 6, height: 22, width, transform: `scaleX(${w}) rotate(-1deg)`, transformOrigin: "left", background: C.sun, borderRadius: 999, zIndex: 0 }} />;
}

function EquationCard({ eq, macros }: { eq: NonNullable<Scene["visual"]["equation"]>; macros?: Record<string, string> }) {
  const { style } = useEnter(eq.at);
  let html: string | null = null;
  if (eq.latex) {
    try {
      html = katex.renderToString(eq.latex, { displayMode: true, throwOnError: true, strict: "ignore", macros: { ...(macros ?? {}) } });
    } catch {
      html = null;
    }
  }
  return (
    <div style={{ ...style, background: C.white, border: `3px solid ${C.ink}`, borderRadius: 32, boxShadow: popShadow(6), padding: "34px 40px 26px", position: "relative" }}>
      <div style={{ position: "absolute", top: -22, right: 34, background: C.skySoft, color: C.skyDeep, border: `3px solid ${C.ink}`, borderRadius: 999, padding: "4px 16px",
        fontFamily: sans, fontWeight: 700, fontSize: 18, transform: "rotate(2deg)" }}>{eq.label}</div>
      {html ? (
        <div style={{ fontSize: 50, color: C.ink, overflow: "hidden", textAlign: "center" }} dangerouslySetInnerHTML={{ __html: html }} />
      ) : eq.image ? (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Img src={staticFile(eq.image)} style={{ maxWidth: "100%", maxHeight: 260, objectFit: "contain", mixBlendMode: "multiply" }} />
        </div>
      ) : null}
    </div>
  );
}

function FigureCard({ fig }: { fig: NonNullable<Scene["visual"]["figure"]> }) {
  const { style } = useEnter(fig.at);
  return (
    <div style={{ ...style, background: C.white, border: `3px solid ${C.ink}`, borderRadius: 32, boxShadow: popShadow(6), padding: 22, display: "flex", flexDirection: "column", gap: 14, minHeight: 0, flex: 1 }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", background: C.canvas, borderRadius: 20, padding: 12 }}>
        <Img src={staticFile(fig.src)} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", mixBlendMode: "multiply" }} />
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
        <span style={{ flexShrink: 0, background: C.lavenderSoft, color: C.purpleDeep, borderRadius: 999, padding: "4px 14px", fontFamily: sans, fontWeight: 700, fontSize: 18 }}>{fig.label}</span>
        <span style={{ fontFamily: sans, fontSize: 19, color: C.inkSoft, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{fig.caption}</span>
      </div>
    </div>
  );
}

function PointRow({ point, i, compact }: { point: Point; i: number; compact: boolean }) {
  const { style } = useEnter(point.at);
  const dots = [C.purple, C.coral, C.mintDeep, C.skyDeep];
  if (point.quote) {
    return (
      <div style={{ ...style, background: C.white, border: `2px solid ${C.line}`, borderLeft: `8px solid ${C.purple}`, borderRadius: 22, padding: compact ? "14px 22px" : "18px 26px", boxShadow: "0 18px 34px -20px rgba(62,44,130,0.35)" }}>
        <div style={{ fontFamily: display, fontSize: compact ? 26 : 30, lineHeight: 1.32, color: C.ink, fontStyle: "italic" }}>&ldquo;{point.text}&rdquo;</div>
        {point.page ? <div style={{ marginTop: 8, fontFamily: sans, fontWeight: 600, fontSize: 18, color: C.muted }}>From the paper · page {point.page}</div> : null}
      </div>
    );
  }
  return (
    <div style={{ ...style, display: "flex", gap: 18, alignItems: "flex-start" }}>
      <span style={{ marginTop: 10, width: 22, height: 22, flexShrink: 0, borderRadius: 999, background: dots[i % dots.length], border: `3px solid ${C.ink}` }} />
      <span style={{ fontFamily: sans, fontWeight: 500, fontSize: compact ? 28 : 33, lineHeight: 1.36, color: C.inkSoft }}>{point.text}</span>
    </div>
  );
}

function TitleCard({ title, authors, source }: { title: string; authors: string; source: string }) {
  const a = useEnter(4);
  const b = useEnter(16);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, justifyContent: "center", flex: 1 }}>
      <div style={{ ...a.style, fontFamily: display, fontWeight: 800, fontSize: title.length > 80 ? 60 : 74, lineHeight: 1.06, color: C.ink, letterSpacing: "-0.02em", position: "relative" }}>
        {title}
      </div>
      <div style={{ ...b.style, display: "flex", flexDirection: "column", gap: 10 }}>
        {authors && <div style={{ fontFamily: sans, fontWeight: 500, fontSize: 28, color: C.inkSoft }}>{authors}</div>}
        {source && <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 22, color: C.muted }}>{source}</div>}
      </div>
    </div>
  );
}

function SceneCard({ scene, index, total, props }: { scene: Scene; index: number; total: number; props: ExplainerProps }) {
  const frame = useCurrentFrame();
  const enter = spring({ frame, fps: 30, config: { damping: 18, stiffness: 120 } });
  const exit = interpolate(frame, [scene.durationInFrames - 8, scene.durationInFrames], [1, 0], clamp);
  const v = scene.visual;
  const heading = useEnter(3);
  const hasMedia = !!(v.figure || v.equation);
  return (
    <AbsoluteFill style={{ left: 690, right: 70, top: 70, bottom: 130, width: "auto", height: "auto",
      opacity: Math.min(1, enter * 1.4) * exit, transform: `translateX(${(1 - enter) * 80}px) rotate(${(1 - enter) * 1.2}deg)` }}>
      <div style={{ position: "absolute", inset: 0, background: C.white, border: `3px solid ${C.ink}`, borderRadius: 44, boxShadow: popShadow(10),
        padding: "50px 60px", display: "flex", flexDirection: "column", gap: 30, overflow: "hidden" }}>
        <Kicker scene={scene} index={index} total={total} />
        {v.layout === "title" ? (
          <TitleCard title={props.title} authors={props.authors} source={props.source} />
        ) : (
          <>
            <div style={{ ...heading.style, position: "relative", alignSelf: "flex-start" }}>
              <Highlighter at={3} width="100%" />
              <h1 style={{ position: "relative", zIndex: 1, margin: 0, fontFamily: display, fontWeight: 800, fontSize: scene.heading.length > 48 ? 50 : 60, lineHeight: 1.08, color: C.ink, letterSpacing: "-0.02em" }}>
                {scene.heading}
              </h1>
            </div>
            {v.equation && <EquationCard eq={v.equation} macros={props.macros} />}
            {v.figure && <FigureCard fig={v.figure} />}
            {v.points.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: hasMedia ? 16 : 24, marginTop: hasMedia ? 0 : 6 }}>
                {v.points.map((p, i) => <PointRow key={i} point={p} i={i} compact={hasMedia} />)}
              </div>
            )}
          </>
        )}
      </div>
    </AbsoluteFill>
  );
}

function Footer({ props, starts, total }: { props: ExplainerProps; starts: number[]; total: number }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: 70, right: 70, bottom: 38, height: 56, display: "flex", alignItems: "center", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, background: C.pill, color: C.white, borderRadius: 999, padding: "10px 22px", fontFamily: sans, fontWeight: 700, fontSize: 20 }}>
        <span style={{ width: 14, height: 14, borderRadius: 999, background: C.sun }} /> Paper Explainer
      </div>
      <div style={{ flex: 1, fontFamily: sans, fontWeight: 600, fontSize: 20, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{props.title}</div>
      <div style={{ display: "flex", gap: 8 }}>
        {props.scenes.map((s, i) => {
          const start = starts[i]!;
          const p = interpolate(frame, [start, start + s.durationInFrames], [0, 1], clamp);
          return (
            <div key={s.id} style={{ width: Math.max(26, Math.min(90, (s.durationInFrames / total) * 900)), height: 14, borderRadius: 999, background: C.white, border: `2px solid ${C.ink}`, overflow: "hidden" }}>
              <div style={{ width: `${p * 100}%`, height: "100%", background: C.purple }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const Explainer: React.FC<ExplainerProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const starts = sceneStarts(props.scenes);
  let idx = 0;
  for (let i = 0; i < starts.length; i++) if (frame >= starts[i]!) idx = i;
  const scene = props.scenes[idx];
  const sceneFrame = frame - (starts[idx] ?? 0);
  const prev = props.scenes[Math.max(0, idx - 1)];
  // Average two frames of loudness so the mouth does not flicker.
  const m = scene?.mouth ?? [];
  const amp = scene ? Math.min(1, ((m[sceneFrame] ?? 0) * 0.65 + (m[sceneFrame - 1] ?? 0) * 0.35)) : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: C.canvas, backgroundImage: "radial-gradient(rgba(28,27,43,0.09) 1.6px, transparent 1.8px)", backgroundSize: "32px 32px", fontFamily: sans }}>
      {/* soft stage behind the mascot */}
      <div style={{ position: "absolute", left: 70, top: 160, width: 560, height: 760, borderRadius: 280, background: C.lavenderSoft, opacity: 0.85 }} />
      <div style={{ position: "absolute", left: 90, top: 70, fontFamily: display, fontWeight: 800, fontSize: 34, color: C.ink, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 40, height: 40, borderRadius: 12, background: C.purple, border: `3px solid ${C.ink}`, boxShadow: popShadow(3), display: "inline-block" }} />
        Tapu explains
      </div>
      {props.scenes.map((s, i) => (
        <Sequence key={s.id} from={starts[i]} durationInFrames={s.durationInFrames} name={`${i + 1}. ${s.kicker}`}>
          <SceneCard scene={s} index={i} total={props.scenes.length} props={props} />
          {s.audio && <Html5Audio src={staticFile(s.audio)} />}
        </Sequence>
      ))}
      {/* above the cards, so the pointing hand reaches over the content */}
      <div style={{ position: "absolute", left: 60, top: 230, width: 580, height: 714 }}>
        {scene && (
          <Mascot pose={scene.pose} prevPose={idx === 0 ? scene.pose : prev!.pose} expression={scene.expression}
            sceneFrame={sceneFrame} frame={frame} amp={amp} fps={fps} />
        )}
      </div>
      <Footer props={props} starts={starts} total={durationInFrames} />
    </AbsoluteFill>
  );
};
