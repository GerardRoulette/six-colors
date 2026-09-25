'use client';

import { GEM_BUCKETS } from '../../game/board/gem';

// Faceted Voronoi board plus the thick territory outlines. Hover is display-only.
// `flatSide` is `{ player, ai }`: the side that just captured is drawn as flat color until the hold ends.
// `playerBoundary` / `aiBoundary` are outline segments `{ a, b }` from `regionBoundary`.
const BoardSvg = ({
  svgWidth,
  svgHeight,
  cells,
  hoveredCell,
  flatSide,
  playerBoundary,
  aiBoundary,
  onCellHover,
  onCellLeave,
}) => (
  <svg width={svgWidth} height={svgHeight} style={{ background: '#1a1a1a', display: 'block' }}>
    {cells.map((cell) => {
      // Dark stroke while the pointer is over this cell (hover is display-only).
      const isHovered = hoveredCell && cell.id === hoveredCell.id;
      // Peak and facet triangles. Missing bevel falls back to the raw Voronoi path.
      const bevel = cell.bevel;
      // True only for tiles owned by the side that just moved; everyone else keeps the gem facets.
      const sideFlat = cell.owner != null && flatSide[cell.owner];
      // Fills for this tile's color, one per facet brightness. Missing for an unknown color.
      const buckets = GEM_BUCKETS[cell.color];
      if (!bevel) {
        return (
          <path
            key={cell.id}
            d={cell.path}
            fill={cell.color}
            onMouseEnter={() => onCellHover(cell)}
            onMouseLeave={onCellLeave}
          />
        );
      }
      return (
        <g key={cell.id} onMouseEnter={() => onCellHover(cell)} onMouseLeave={onCellLeave}>
          <path d={bevel.outerPath} fill={cell.color} />
          {!sideFlat && buckets && bevel.buckets.map((d, i) => d && (
            <path
              key={i}
              d={d}
              fill={buckets[i]}
              pointerEvents="none"
            />
          ))}
          {isHovered && (
            <path d={bevel.outerPath} fill="none" stroke="#222" strokeWidth={1.5} pointerEvents="none" />
          )}
        </g>
      );
    })}
    {playerBoundary.length > 0 && (
      <g pointerEvents="none">
        {playerBoundary.map((seg, i) => (
          <path
            key={`p-boundary-${i}`}
            d={`M ${seg.a[0]} ${seg.a[1]} L ${seg.b[0]} ${seg.b[1]}`}
            fill="none"
            stroke="dodgerblue"
            strokeWidth={6}
          />
        ))}
      </g>
    )}
    {aiBoundary.length > 0 && (
      <g pointerEvents="none">
        {aiBoundary.map((seg, i) => (
          <path
            key={`a-boundary-${i}`}
            d={`M ${seg.a[0]} ${seg.a[1]} L ${seg.b[0]} ${seg.b[1]}`}
            fill="none"
            stroke="crimson"
            strokeWidth={6}
          />
        ))}
      </g>
    )}
  </svg>
);

export default BoardSvg;
