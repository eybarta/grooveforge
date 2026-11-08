#!/usr/bin/env bash
# Forge transition vs the motion spec (P3 gate). Needs `npm run web` running, Chrome and ffmpeg (no npm deps).
# Spec stills are 390×844 (1×); the spec video is 780×1688 (2×).
#   scripts/capture-forge.sh stills   → out/forge/t*.png at the spec's still times + SSIM against docs/motion/stills
#   scripts/capture-forge.sh video    → out/forge/forge.mp4 (60 fps) + out/forge/side-by-side.mp4 next to the spec video
set -euo pipefail
MODE=${1:-stills}
URL=${URL:-http://localhost:8081/dev/forge}
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
OUT=out/forge
mkdir -p "$OUT/frames"
PROFILE=$(mktemp -d)
trap 'rm -rf "$PROFILE"' EXIT

shot() { # $1 = t (s), $2 = output png, $3 = pixel scale (stills 1×, video 2×); software WebGL for CanvasKit
  # the window is bigger than the frame (headless Chrome has a minimum width); the frame is cropped from its top-left
  "$CHROME" --headless=new --user-data-dir="$PROFILE" --hide-scrollbars --window-size=600,1000 --force-device-scale-factor="$3" \
    --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=15000 \
    --screenshot="$2.raw.png" "$URL?t=$1&capture" >/dev/null 2>&1
  ffmpeg -y -hide_banner -loglevel error -i "$2.raw.png" -vf "crop=$((390 * $3)):$((844 * $3)):0:0" "$2" && rm "$2.raw.png"
}

if [ "$MODE" = stills ]; then
  for f in docs/motion/stills/t*.png; do
    name=$(basename "$f" .png)            # t003.600
    t=$(echo "${name#t}" | sed 's/^0*//; s/^\./0./')
    shot "$t" "$OUT/$name.png" 1
    ssim=$(ffmpeg -hide_banner -i "$OUT/$name.png" -i "$f" -lavfi "ssim" -f null - 2>&1 | sed -n 's/.*All:\([0-9.]*\).*/\1/p')
    echo "$name  SSIM $ssim"
  done
else
  dur=7.5; n=$(echo "$dur * 60 / 1" | bc)
  for i in $(seq 0 $((n - 1))); do shot "$(echo "scale=4; $i / 60" | bc)" "$OUT/frames/$(printf %04d "$i").png" 2; done
  ffmpeg -y -hide_banner -loglevel error -framerate 60 -i "$OUT/frames/%04d.png" -pix_fmt yuv420p "$OUT/forge.mp4"
  ffmpeg -y -hide_banner -loglevel error -i docs/motion/forge-transition.mp4 -i "$OUT/forge.mp4" \
    -filter_complex "[0:v]scale=780:1688[a];[1:v]scale=780:1688[b];[a][b]hstack" -pix_fmt yuv420p "$OUT/side-by-side.mp4"
  echo "$OUT/side-by-side.mp4 (left: spec, right: app)"
fi
