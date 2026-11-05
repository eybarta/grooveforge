# Motion spec: Forge transition

- forge-transition.mp4: 7.5 s at 112 BPM, 60 fps, 780x1688.
- forge-film/film.html: the exact timeline as a pure function seek(t). Open it in a browser to scrub (Space = play/pause, arrows = step a frame, ?t=3.2 deep link).
- forge-film/BEATMAP.md: beat-by-beat description.
- Spring params in film.html map to Reanimated withSpring: damping ratio z ~0.8; stiffness w (rad/s) -> stiffness = w^2 with mass 1.
- Re-render: python render.py full film.html --sub 8 --workers 3 --scale 2 (needs playwright + ffmpeg; render.py points at /usr/bin/google-chrome, change if needed).
