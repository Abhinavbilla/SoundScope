// See mediabunny-frame-index.js. Re-exports everything else from the original module.
export * from "virtual:mediabunny-original/mp3/mp3-demuxer.js";
import { Mp3Demuxer as Original } from "virtual:mediabunny-original/mp3/mp3-demuxer.js";
import { createFrameIndex, PACKET_FIELDS } from "./mediabunny-frame-index.js";

export class Mp3Demuxer extends Original {
  constructor(input) {
    super(input);
    this.loadedSamples = createFrameIndex(PACKET_FIELDS);
  }
}
