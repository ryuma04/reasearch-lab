/** "Soft Clay & Calm Bento" tokens, copied from frontend/src/app/globals.css so the video matches the app. */
import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";

export const C = {
  canvas: "#f5f1e8",
  ink: "#1c1b2b",
  inkSoft: "#3a3850",
  muted: "#625f78",
  faint: "#9794ab",
  line: "#e8e2d6",
  pill: "#1c1b22",
  white: "#ffffff",
  purple: "#7b5cf0",
  purpleDeep: "#5a3dd4",
  lavender: "#c6b5f6",
  lavenderSoft: "#ece5fe",
  sun: "#fad47f",
  sunSoft: "#fef3d6",
  sunDeep: "#a86f00",
  coral: "#f08a6c",
  coralSoft: "#fde3d9",
  mint: "#d0e8ba",
  mintSoft: "#e8f4dc",
  mintDeep: "#3f8a2e",
  sky: "#c4def8",
  skySoft: "#e3effc",
  skyDeep: "#2f6fbf",
  pink: "#f9cbc9",
  pinkSoft: "#fde4e2",
};

export const display = loadFraunces("normal", { weights: ["600", "700", "800"], subsets: ["latin"] }).fontFamily;
export const sans = loadPoppins("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;

/** Kicker sticker colour per scene kind (one chromatic tone per card, §3.4). */
export const kindTone: Record<string, { bg: string; fg: string }> = {
  intro: { bg: C.sun, fg: C.ink },
  problem: { bg: C.coralSoft, fg: "#c4502f" },
  method: { bg: C.lavenderSoft, fg: C.purpleDeep },
  equation: { bg: C.skySoft, fg: C.skyDeep },
  result: { bg: C.mintSoft, fg: C.mintDeep },
  conclusion: { bg: C.sun, fg: C.ink },
};

export const popShadow = (n = 5, color = C.ink) => `${n}px ${n}px 0 ${color}`;
