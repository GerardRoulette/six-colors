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
  // const colors = ['hsl(356, 89%, 65%)', 'hsl(34, 91%, 56%)', 'hsl(60, 89%, 71%)', 'hsl(300, 92%, 71%)', 'hsl(110, 91%, 66%)', 'hsl(232, 90%, 76%)']
  const colors = ['orangered', 'goldenrod', 'khaki', 'orchid', 'yellowgreen', 'cadetblue']
  return sites.map((site, index) => ({
    id: index,
    site: site,
    path: voronoi.renderCell(index),
    color: colors[Math.floor(Math.random() * colors.length)],
    neighbors: Array.from(delaunay.neighbors(index)) || [], // Убедимся, что neighbors — это массив
  }));
};

const VoronoiDiagram = ({ numPoints = 50 }) => {
  const sites = useMemo(() => generateSites(numPoints, width, height), [numPoints]);
  const { delaunay, voronoi } = useMemo(() => generateVoronoi(sites, width, height), [sites]);
  const cells = useMemo(() => createCells(sites, voronoi, delaunay), [sites, voronoi, delaunay]);

  const [hoveredCell, setHoveredCell] = React.useState(null);
  const [selectedCell, setSelectedCell] = React.useState(null);

  const handleCellClick = (cell) => {
    setSelectedCell(cell.id);
  };

  return (
    <svg width={width} height={height}>
    
      {cells.map((cell) => {
        // Проверяем, выбрана ли ячейка или её соседи
        const isSelected =
          selectedCell !== null &&
          (cell.id === selectedCell || cells[selectedCell].neighbors.includes(cell.id));

        // Проверяем, наведен ли курсор на ячейку или её соседей
        const isHovered =
        hoveredCell &&
        Array.isArray(hoveredCell.neighbors) &&
        (cell.id === hoveredCell.id || // Ячейка, на которую наведен курсор
          (hoveredCell.neighbors.includes(cell.id) && // Или соседняя ячейка
            cell.color === hoveredCell.color)); // С таким же цветом

        // Определяем цвет ячейки
        const fillColor = isSelected ? "greenyellow" : isHovered ? "orange" : cell.color;
        const fillStroke = isSelected ? "red" : isHovered ? "lime" : "black";
        const widthStroke = isSelected ? 2 : isHovered ? 2 : 1;
        return (
          <path
            key={cell.id}
            d={cell.path}
            fill={fillColor}
            filter={`url(#lightEffect${cell.id})`}
            stroke={fillStroke}
            strokeWidth={widthStroke}
            onMouseEnter={() => setHoveredCell(cell)}
            onMouseLeave={() => setHoveredCell(null)}
            onClick={() => handleCellClick(cell)}
            
          />
        );
      })}
    </svg>
  );
};

export default VoronoiDiagram;