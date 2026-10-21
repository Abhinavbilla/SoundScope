// See mediabunny-frame-index.js. Re-exports everything else from the original module.
export * from "virtual:mediabunny-original/adts/adts-demuxer.js";
import { AdtsDemuxer as Original } from "virtual:mediabunny-original/adts/adts-demuxer.js";
import { createFrameIndex, PACKET_FIELDS } from "./mediabunny-frame-index.js";

export class AdtsDemuxer extends Original {
  constructor(input) {
    super(input);
    this.loadedSamples = createFrameIndex(PACKET_FIELDS);
  }
}
