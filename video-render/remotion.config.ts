import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);

Config.overrideWebpackConfig((currentConfig) => ({
  ...currentConfig,
  resolve: {
    ...currentConfig.resolve,
    fallback: {
      ...(currentConfig.resolve?.fallback || {}),
      fs: false,
    },
  },
  externals: [
    ...(currentConfig.externals || []),
    "fs",
  ],
}));