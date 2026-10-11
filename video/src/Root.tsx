import React from "react";
import { Composition } from "remotion";
import { Explainer } from "./Explainer";
import { sample } from "./sample";
import { FPS, HEIGHT, WIDTH, type ExplainerProps } from "./types";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Explainer"
    component={Explainer}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    durationInFrames={FPS * 10}
    defaultProps={sample as ExplainerProps}
    // The video is exactly as long as the narration: the sum of the scenes' clip lengths.
    calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, props.scenes.reduce((n, s) => n + s.durationInFrames, 0)) })}
  />
);
