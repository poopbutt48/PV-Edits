# Forge Studio

A browser app for describing a 3D part in plain language, editing it, and checking it with
finite-element analysis and 3D topology optimization.

Open `index.html` through any static web server (or directly from disk). It loads three.js
from the jsDelivr CDN, so it needs an internet connection.

## What it does

- **Describe → model.** Type a description and a material. With an Anthropic API key
  (AI settings) Claude builds a model from primitives; without one, a built-in offline
  generator handles common objects (brackets, beams, plates, enclosures, tables, chairs,
  mugs, gears, wheels, hooks, columns, pipes). *Edit current* asks Claude to modify the
  existing model.
- **Edit.** Select parts, move/rotate/resize with the gizmo (W/E/R), type exact dimensions,
  mark parts as cuts (holes, pockets), duplicate, delete, undo/redo. Save/open as JSON,
  export the combined solid as binary STL (mm).
- **Materials.** Steels, aluminium, titanium, copper, brass, PLA, PETG, ABS, nylon, carbon
  fibre, oak, concrete, glass, all editable. Values are typical figures; check a datasheet.
- **Analyze.** Click the model to place fixed supports and loads, then run a linear-elastic
  static analysis on a voxel mesh (8-node hex elements, matrix-free PCG solver in a Web
  Worker). Reports mass, max displacement, max von Mises stress and safety factor, and shows a
  stress map.
- **Topology optimization.** 3D SIMP (penalty 3) with a density filter and optimality-criteria
  updates, minimising compliance at a target volume fraction. Material near supports and
  loads can be kept. Adjust the density cutoff, check the optimized part with a new analysis,
  and export it as STL.

## Limits

- Linear elastic, small deflections, isotropic materials. Printed plastics, wood and
  composites are direction-dependent in reality; concrete and glass are brittle.
- Stress is sampled at voxel centres, so coarse meshes under-read peak surface stress and
  sharp corners / point loads can read high. Re-run at a finer resolution to check.
- Features thinner than about two voxels are poorly represented.
- The solver was checked against Euler–Bernoulli beam theory for a cantilever: tip deflection
  within about 3% at 4 elements through the depth and under 1% at 8.

## Files

- `index.html` — UI, modelling, signed-distance geometry, meshing, STL export, AI calls.
- `fea-core.js` — FE solver and SIMP optimizer (runs as a Web Worker; also `require`-able in Node).
