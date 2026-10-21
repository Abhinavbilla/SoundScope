#!/bin/sh
# Regenerate the 20 s sample clips used by device-test.html (one per format) from a local test file.
# Usage: sh tools/make-device-samples.sh <ffmpeg> <source audio>
FF="$1"; SRC="$2"; OUT=public/device-samples
mkdir -p "$OUT"
"$FF" -v error -y -ss 60 -t 20 -i "$SRC" -c:a libmp3lame -b:a 192k "$OUT/clip.mp3"
"$FF" -v error -y -ss 60 -t 20 -i "$SRC" -c:a aac -b:a 160k "$OUT/clip.m4a"
"$FF" -v error -y -ss 60 -t 20 -i "$SRC" -c:a aac -b:a 160k -f adts "$OUT/clip.aac"
"$FF" -v error -y -ss 60 -t 20 -i "$SRC" -c:a flac "$OUT/clip.flac"
"$FF" -v error -y -ss 60 -t 20 -i "$SRC" -c:a libvorbis -q:a 5 "$OUT/clip.ogg"
"$FF" -v error -y -ss 60 -t 20 -i "$SRC" -c:a pcm_s16le "$OUT/clip.wav"
