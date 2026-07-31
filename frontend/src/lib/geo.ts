/** Geometry helpers shared by the point and polygon rendering paths. */

import type { UnitFeature } from "./types";

export type LngLatBoundsTuple = [[number, number], [number, number]];

/**
 * Exact bbox of any geometry.
 *
 * Hand-rolled rather than pulling in @turf/bbox: that would add three packages
 * to a four-dependency project for twenty lines of reduction, and there is no
 * antimeridian or CRS subtlety at 74°W. Total vertex count across all 1,141
 * Bogotá zones is ~189,000, and only one feature is ever walked per selection.
 */
export function featureBounds(f: UnitFeature): LngLatBoundsTuple {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const visit = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const x = c[0] as number;
      const y = c[1] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      return;
    }
    for (const part of c) visit(part);
  };

  visit(f.geometry.coordinates);
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

/** Centre of a feature's bbox. Not a true centroid — label it as such in exports. */
export function bboxCentre(f: UnitFeature): [number, number] {
  const [[w, s], [e, n]] = featureBounds(f);
  return [(w + e) / 2, (s + n) / 2];
}
