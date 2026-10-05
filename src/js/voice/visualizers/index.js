// The canvas visualizers. Each module exports draw(ctx, t, w, h, frame); the
// frame is { levels, loudness, voiceLevels, state, muted }. A module that
// exports voiceBands = true also gets the finer bands in frame.voiceLevels.
// The "robot" style isn't here: it draws itself (src/js/robot/).
import * as sunset from "./sunset.js";
import * as aurora from "./aurora.js";
import * as cosmic from "./cosmic.js";
import * as zen from "./zen.js";
import * as hearth from "./hearth.js";

export const VISUALIZERS = { sunset, aurora, cosmic, zen, hearth };

export const visualizer = (name) => VISUALIZERS[name] || sunset;
