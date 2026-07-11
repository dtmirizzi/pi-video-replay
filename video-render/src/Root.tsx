import { Composition } from "remotion";
import { CastVideo } from "./Composition";
import durationConfig from "./duration.json" with { type: "json" };
import castData from "./cast-data.json" with { type: "json" };

const fps = 30;
const durationInFrames = Math.max(30, durationConfig.frames || 30 * 300);

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MyComposition"
      component={CastVideo}
      durationInFrames={durationInFrames}
      fps={fps}
      width={1920}
      height={1080}
      defaultProps={{
        castEvents: castData.events,
        fps,
        cols: durationConfig.cols || 100,
        rows: durationConfig.rows || 30,
      }}
    />
  );
};