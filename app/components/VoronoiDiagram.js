"use client"; // Указываем, что это клиентский компонент

import React, { useMemo } from "react";
import { Delaunay } from "d3-delaunay";

const width = 800;
const height = 600;

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
  const colors = ['orangered', 'goldenrod', 'khaki', 'orchid', 'yellowgreen', 'cadetblue'];
  return sites.map((site, index) => ({
    id: index,
    site: site,
    path: voronoi.renderCell(index),
    color: colors[Math.floor(Math.random() * colors.length)],
    neighbors: Array.from(delaunay.neighbors(index)) || [], // Ensure neighbors is an array
  }));
};

// Function to find the most left-down and most right-up cells using sorting
const findBoundaryCells = (sites) => {
  // Sort sites to find the most left-down and most right-up cells
  const sortedByX = [...sites].sort((a, b) => a[0] - b[0]); // Sort by x-coordinate
  const sortedByY = [...sites].sort((a, b) => a[1] - b[1]); // Sort by y-coordinate

  const leftDownSite = sortedByX[0]; // Smallest x, largest y
  const rightUpSite = sortedByX[sites.length - 1]; // Largest x, smallest y

  // Find the corresponding cell IDs
  const leftDownCellId = sites.findIndex(site => site[0] === leftDownSite[0] && site[1] === leftDownSite[1]);
  const rightUpCellId = sites.findIndex(site => site[0] === rightUpSite[0] && site[1] === rightUpSite[1]);

  return { leftDownCellId, rightUpCellId };
};

const VoronoiDiagram = ({ numPoints = 50 }) => {
  const sites = useMemo(() => generateSites(numPoints, width, height), [numPoints]);
  const { delaunay, voronoi } = useMemo(() => generateVoronoi(sites, width, height), [sites]);
  const cells = useMemo(() => createCells(sites, voronoi, delaunay), [sites, voronoi, delaunay]);

  // Identify the boundary cells using sorting
  const { leftDownCellId, rightUpCellId } = useMemo(() => findBoundaryCells(sites), [sites]);

  const [hoveredCell, setHoveredCell] = React.useState(null);
  const [selectedCell, setSelectedCell] = React.useState(null);

  const handleCellClick = (cell) => {
    const sameColorCells = findSameColorNeighbors(cell.id, cells);
    sameColorCells.forEach((cellId) => {
      cells[cellId].color = "greenyellow";
    });
    setSelectedCell(cell.id);
  };

  const handleCellHover = (cell) => {
    const sameColorCells = findSameColorNeighbors(cell.id, cells);
    sameColorCells.forEach((cellId) => {
      cells[cellId].color = "orange";
    });
    setHoveredCell(cell);
  };

  const handleMouseLeave = () => {
    if (hoveredCell) {
      const sameColorCells = findSameColorNeighbors(hoveredCell.id, cells);
      sameColorCells.forEach((cellId) => {
        cells[cellId].color = hoveredCell.color;
      });
    }
    setHoveredCell(null);
  };

  return (
    <svg width={width} height={height}>
      {cells.map((cell) => {
        const isSelected =
          selectedCell !== null &&
          (cell.id === selectedCell || cells[selectedCell].neighbors.includes(cell.id));

        const isHovered =
          hoveredCell &&
          Array.isArray(hoveredCell.neighbors) &&
          (cell.id === hoveredCell.id || hoveredCell.neighbors.includes(cell.id));

        // Set the boundary cells to black
        const fillColor =
          cell.id === leftDownCellId || cell.id === rightUpCellId
            ? "black"
            : isSelected
            ? "greenyellow"
            : isHovered
            ? "orange"
            : cell.color;

        const fillStroke = isSelected ? "red" : isHovered ? "lime" : "black";
        const widthStroke = isSelected ? 0 : isHovered ? 0 : 1;
        const zIndex = isSelected ? 'z-10' : isHovered ? 'z-10' : 'z-1';

        return (
          <path
            key={cell.id}
            d={cell.path}
            fill={fillColor}
            filter={`url(#lightEffect${cell.id})`}
            stroke={fillStroke}
            strokeWidth={widthStroke}
            onMouseEnter={() => handleCellHover(cell)}
            onMouseLeave={handleMouseLeave}
            onClick={() => handleCellClick(cell)}
            className={zIndex}
          />
        );
      })}
    </svg>
  );
};

// Function to find all neighboring cells with the same color
const findSameColorNeighbors = (cellId, cells) => {
  const visited = new Set();
  const queue = [cellId];
  const targetColor = cells[cellId].color;
  const sameColorCells = [];

  while (queue.length > 0) {
    const currentCellId = queue.shift();

    if (visited.has(currentCellId)) continue;
    visited.add(currentCellId);

    if (cells[currentCellId].color === targetColor) {
      sameColorCells.push(currentCellId);

      const neighbors = cells[currentCellId].neighbors;
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          queue.push(neighborId);
        }
      }
    }
  }

  return sameColorCells;
};

export default VoronoiDiagram;