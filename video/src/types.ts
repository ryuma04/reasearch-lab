/**
 * Props contract between the agent worker (agents/lab/explainer/render.py writes props.json) and this composition.
 * Every path is relative to the render's public dir and is loaded with staticFile().
 */
export type Pose = "explaining" | "pointing" | "thinking" | "excited" | "concluding";
export type Expression = "happy" | "curious" | "focused" | "surprised" | "proud";
export type SceneKind = "intro" | "problem" | "method" | "equation" | "result" | "conclusion";

export interface Point {
  text: string;
  /** A sentence copied verbatim from the paper (shown in quotes with its page). */
  quote: boolean;
  page?: number | null;
  /** Frame (inside the scene) at which the point appears. */
  at: number;
}

export interface Visual {
  layout: "title" | "equation" | "figure" | "points";
  equation?: {
    /** Exact LaTeX from the paper's arXiv source, rendered with KaTeX. */
    latex?: string | null;
    /** Crop of the equation from the PDF page (used when no LaTeX source exists). */
    image?: string | null;
    aspect?: number | null;
    label: string;
    at: number;
  } | null;
  figure?: { src: string; caption: string; aspect: number; label: string; at: number } | null;
  points: Point[];
}

export interface Scene {
  id: string;
  kind: SceneKind;
  kicker: string;
  heading: string;
  narration: string;
  pose: Pose;
  expression: Expression;
  audio: string;
  durationInFrames: number;
  /** Mouth openness per frame of this scene, 0..1, from the voice clip's loudness. */
  mouth: number[];
  visual: Visual;
}

export interface ExplainerProps {
  title: string;
  authors: string;
  source: string;
  /** Simple \newcommand macros from the paper's LaTeX source, for KaTeX. */
  macros?: Record<string, string>;
  scenes: Scene[];
  [key: string]: unknown;
}

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
