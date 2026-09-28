'use client';

import { GEM_BUCKETS, GEM_FLASH_BUCKETS } from '../../game/board/gem';

// Faceted Voronoi board plus the thick territory outlines. Hover is display-only.
// `viewWidth` / `viewHeight` are the fixed map coordinates (paths stay in this space across resizes).
// `svgWidth` / `svgHeight` are the on-screen pixel size; the viewBox scales the map into that box.
// `blinkBright` is `{ player, ai }`: that side's gems use lighter opaque facets while its own flash is on the bright half.
// `playerBoundary` / `aiBoundary` are outline segments `{ a, b }` from `regionBoundary`.
const BoardSvg = ({
  viewWidth,
  viewHeight,
  svgWidth,
  svgHeight,
  cells,
  hoveredCell,
  blinkBright,
  playerBoundary,
  aiBoundary,
  onCellHover,
  onCellLeave,
}) => (
  <svg
    viewBox={`0 0 ${viewWidth} ${viewHeight}`}
    width={svgWidth}
    height={svgHeight}
    style={{ background: '#1a1a1a', display: 'block' }}
  >
    {cells.map((cell) => {
      // Dark stroke while the pointer is over this cell (hover is display-only).
      const isHovered = hoveredCell && cell.id === hoveredCell.id;
      // Peak and facet triangles. Missing bevel falls back to the raw Voronoi path.
      const bevel = cell.bevel;
      // True on the bright half of this tile's owner's own flash. The other side keeps its own clock.
      const sideBlink = cell.owner != null && blinkBright[cell.owner];
      // Fills for this tile's color, one per facet brightness. The lighter set is still fully opaque. Missing for an unknown color.
      const buckets = sideBlink ? GEM_FLASH_BUCKETS[cell.color] : GEM_BUCKETS[cell.color];
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
        <g
          key={cell.id}
          onMouseEnter={() => onCellHover(cell)}
          onMouseLeave={onCellLeave}
        >
          <path d={bevel.outerPath} fill={cell.color} />
          {buckets && bevel.buckets.map((d, i) => d && (
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
