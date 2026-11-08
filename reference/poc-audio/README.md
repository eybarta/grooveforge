# POC audio (reference only)

The GrooveForge 1 proof-of-concept audio code, kept for its ideas (scheduler, EditMap, flavor concept).
App code must never import from here. Two exceptions:
- the golden-test harness uses `analyze.ts` as the baseline detector until Phase 2 replaces it;
- the Phase 1 blind A/B (`src/ab/`, the `/dev/ab` dev page) renders the same patterns through `engine.ts` to compare v2 with the POC.
