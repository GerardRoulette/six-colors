import { Delaunay } from 'd3-delaunay';
import { PALETTE } from '../moves';
import { buildCellBevel } from './gem';

// `numPoints` random [x, y] sites in the SVG rectangle; these become Voronoi cell seeds.
export const generateSites = (numPoints, width, height) => {
  // Seed coordinates, one pair per cell.
  const sites = [];
  for (let i = 0; i < numPoints; i++) {
    sites.push([Math.random() * width, Math.random() * height]);
  }
  return sites;
};

// Delaunay triangulation of `sites`, then a Voronoi clipped to [0, 0, width, height].
export const generateVoronoi = (sites, width, height) => {
  const delaunay = Delaunay.from(sites);
  const voronoi = delaunay.voronoi([0, 0, width, height]);
  return { delaunay, voronoi };
};

// One board cell per site: SVG path, polygon, bevel geometry, random color, Delaunay neighbors, no owner yet.
export const createCells = (sites, voronoi, delaunay) => {
  return sites.map((site, index) => {
    // Closed polygon; the grout outline is derived from it once and kept across recolors.
    const polygon = voronoi.cellPolygon(index);
    return {
      id: index,
      site: site,
      path: voronoi.renderCell(index), // svg path string for this cell
      polygon, // array of points [x,y] describing the cell polygon (closed)
      bevel: buildCellBevel(polygon), // peak plus one shaded triangle per edge
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)], // random color
      neighbors: Array.from(delaunay.neighbors(index)) || [], // array of neighboring cells
      owner: null, // owner of the cell - 'player' / 'ai' / null
    };
  });
};

// Closest sites to the four SVG corners via Delaunay.find; returned as a Set of cell ids (marked `isCorner` in the UI board).
export const getCornerCellIds = (delaunay, width, height) => {
  const topLeft = delaunay.find(0, 0);
  const topRight = delaunay.find(width, 0);
  const bottomLeft = delaunay.find(0, height);
  const bottomRight = delaunay.find(width, height);
  return new Set([topLeft, topRight, bottomLeft, bottomRight]);
};

// Starting cell ids on the same triangulation as the board: player bottom-left, AI top-right.
export const getStartIds = (delaunay, width, height) => ({
  playerStartId: delaunay.find(0, height),
  aiStartId: delaunay.find(width, 0),
});
