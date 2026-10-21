// See mediabunny-frame-index.js. Re-exports everything else from the original module.
export * from "virtual:mediabunny-original/flac/flac-demuxer.js";
import { FlacDemuxer as Original } from "virtual:mediabunny-original/flac/flac-demuxer.js";
import { createFrameIndex, FLAC_FIELDS } from "./mediabunny-frame-index.js";

export class FlacDemuxer extends Original {
  constructor(input) {
    super(input);
    this.loadedSamples = createFrameIndex(FLAC_FIELDS);
  }
}
