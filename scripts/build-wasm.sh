#!/usr/bin/env bash
# Builds the C++ engine to standalone WASM for the web AudioWorklet → public/gf-engine.wasm
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public
EXPORTS='["_gf_create","_gf_destroy","_gf_alloc","_gf_free","_gf_process","_gf_set_events","_gf_play","_gf_stop","_gf_set_drive","_gf_capture_start","_gf_capture_stop","_gf_captured","_gf_capture_in","_gf_capture_out"]'
em++ -std=c++20 -O3 -fno-exceptions -fno-rtti \
  -Iengine/include engine/src/Engine.cpp engine/wasm/gf_wasm.cpp \
  -sSTANDALONE_WASM --no-entry \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sINITIAL_MEMORY=33554432 -sALLOW_MEMORY_GROWTH=0 \
  -o public/gf-engine.wasm
echo "built public/gf-engine.wasm ($(wc -c < public/gf-engine.wasm) bytes)"
