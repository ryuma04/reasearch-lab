import type { ExplainerProps, Scene } from "./types";

/** Preview-only props for `npm run studio` (no audio; the mouth follows a synthetic loudness curve). Real renders get props.json. */
const talk = (frames: number) => Array.from({ length: frames }, (_, i) => Math.max(0, Math.sin(i / 2.3) * 0.5 + Math.sin(i / 5.1) * 0.35));

const scene = (id: string, kind: Scene["kind"], pose: Scene["pose"], expression: Scene["expression"], visual: Scene["visual"], heading: string, kicker: string): Scene => ({
  id, kind, pose, expression, visual, heading, kicker, narration: "", audio: "", durationInFrames: 120, mouth: talk(120),
});

export const sample: ExplainerProps = {
  title: "Sample paper title for the studio preview",
  authors: "First Author, Second Author",
  source: "Preview data, not a real paper",
  scenes: [
    scene("s1", "intro", "excited", "happy", { layout: "title", points: [] }, "", "Paper explainer"),
    scene("s2", "problem", "explaining", "curious", {
      layout: "points",
      points: [
        { text: "A first point the narration talks about", quote: false, at: 10 },
        { text: "A sentence quoted verbatim from the paper appears like this.", quote: true, page: 2, at: 40 },
      ],
    }, "The problem", "The problem"),
    scene("s3", "equation", "pointing", "focused", {
      layout: "equation",
      equation: { latex: "\\mathcal{L} = \\sum_{i=1}^{N} \\left( y_i - \\hat{y}_i \\right)^2", label: "Eq. (1) · page 3", at: 12 },
      points: [{ text: "What each symbol means, in plain words", quote: false, at: 50 }],
    }, "The key equation", "The method"),
    scene("s4", "conclusion", "concluding", "proud", { layout: "points", points: [{ text: "The takeaway", quote: false, at: 10 }] }, "Takeaways", "Conclusion"),
  ],
};
