import { strength } from "../results/intervals.js";

/** Three small bars and a word (Maybe / Likely / Very likely) instead of a raw score. */
export default function Strength({ confidence, threshold, showWord = true }) {
  const { level, word } = strength(confidence, threshold);
  return (
    <span className="strength" data-level={level} title={word}>
      <span className="strength__bars" aria-hidden="true"><i /><i /><i /></span>
      {showWord ? <span className="strength__word">{word}</span> : <span className="visually-hidden">{word}</span>}
    </span>
  );
}
