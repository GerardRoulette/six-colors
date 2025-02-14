"use client"; // Указываем, что это клиентский компонент

import React, { useMemo } from "react";
import { Delaunay } from "d3-delaunay";

const width = 300;
const height = 300;

const generateSites = (numPoints, width, height) => {
  const sites = [];
  for (let i = 0; i < numPoints; i++) {
    sites.push([Math.random() * width, Math.random() * height]);
  }
  return sites;
};

const generateVoronoi = (sites, width, height) => {
  const delaunay = Delaunay.from(sites);
  const voronoi = delaunay.voronoi([0, 0, width, height]);
  return { delaunay, voronoi };
};

const createCells = (sites, voronoi, delaunay) => {
    return sites.map((site, index) => ({
      id: index,
      site: site,
      path: voronoi.renderCell(index),
      color: `hsl(${Math.random() * 360}, 70%, 80%)`,
      neighbors: delaunay.neighbors(index) || [], // Если neighbors undefined, используем пустой массив
    }));
  };

const VoronoiDiagram = ({ numPoints = 50 }) => {
  const sites = useMemo(() => generateSites(numPoints, width, height), [numPoints]);
  const { delaunay, voronoi } = useMemo(() => generateVoronoi(sites, width, height), [sites]);
  const cells = useMemo(() => createCells(sites, voronoi, delaunay), [sites, voronoi, delaunay]);

  const [hoveredCell, setHoveredCell] = React.useState(null);

  return (
    <svg width={width} height={height}>
      {cells.map((cell) => (
        <path
          key={cell.id}
          d={cell.path}
          fill={
            hoveredCell &&
            Array.isArray(hoveredCell.neighbors) && // Проверяем, что neighbors — это массив
            (cell.id === hoveredCell.id || hoveredCell.neighbors.includes(cell.id))
              ? "orange"
              : cell.color
          }
          stroke="black"
          strokeWidth={1}
          onMouseEnter={() => setHoveredCell(cell)}
          onMouseLeave={() => setHoveredCell(null)}
        />
      ))}
    </svg>
  );
};

export default VoronoiDiagram;