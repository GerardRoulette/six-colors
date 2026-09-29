'use client';

import { GEM_BUCKETS, GEM_FLASH_BUCKETS } from '../../game/board/gem';
import { offsetSegmentTowardOwner } from '../../game/board/adjacency';

// Territory outline thickness in map units. Thin so the gem facets stay readable.
const TERRITORY_STROKE_WIDTH = 2;
// Combined acid thickness where player and AI share a wall, in map units. Each side paints half.
const SHARED_STROKE_WIDTH = 6;
// Player outline: bright acid light blue, so the border stays visible on every gem.
const PLAYER_BOUNDARY_STROKE = '#4DFFF6';
// AI outline: bright acid light red, the same contrast job on the opposite territory.
const AI_BOUNDARY_STROKE = '#FF4D73';
// Black rim around each acid stroke, in screen pixels per side.
const TERRITORY_RIM_PX = 1;

// Acid territory stroke with a 1px black rim. The bloom sits behind the rim; the sharp core is painted last.
// `segments` are `{ a, b, shared }` outline pieces. `outlineWidth` is the black stroke in map units (acid width plus the rim).
// A shared wall is `SHARED_STROKE_WIDTH` across: this side paints only its half, so the two colors meet instead of stacking.
const TerritoryOutline = ({ segments, color, keyPrefix, outlineWidth }) => {
  if (!segments.length) return null;
  // 1px black rim in map units, taken from the full black stroke minus the acid core.
  const rim = (outlineWidth - TERRITORY_STROKE_WIDTH) / 2;
  // This side's half of a shared wall, in map units.
  const sharedHalf = SHARED_STROKE_WIDTH / 2;
  // Walls against empty cells or the map edge. These stay centered on the edge.
  const outerSegs = segments.filter((seg) => !seg.shared);
  // Acid half, centered a quarter of the shared thickness into this cell so it fills only this side of the wall.
  const sharedCore = [];
  // Black rim on the outer side of that half only, so no black stripe sits between the two colors.
  const sharedRim = [];
  for (const seg of segments) {
    if (!seg.shared) continue;
    sharedCore.push(offsetSegmentTowardOwner(seg, sharedHalf / 2));
    sharedRim.push(offsetSegmentTowardOwner(seg, sharedHalf + rim / 2));
  }
  // One copy of `list`. `stroke` and `width` are that copy's paint; `tag` keeps keys unique.
  const strokes = (list, stroke, width, tag) => list.map((seg, i) => (
    <path
      key={`${keyPrefix}-${tag}-${i}`}
      d={`M ${seg.a[0]} ${seg.a[1]} L ${seg.b[0]} ${seg.b[1]}`}
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
    />
  ));
  return (
    <g pointerEvents="none">
      {outerSegs.length > 0 && (
        <g filter="url(#territory-strike)">
          {strokes(outerSegs, color, TERRITORY_STROKE_WIDTH, 'bloom')}
        </g>
      )}
      {strokes(outerSegs, '#000', outlineWidth, 'rim')}
      {strokes(sharedRim, '#000', rim, 'shared-rim')}
      {strokes(outerSegs, color, TERRITORY_STROKE_WIDTH, 'core')}
      {strokes(sharedCore, color, sharedHalf, 'shared-core')}
    </g>
  );
};

// Faceted Voronoi board plus the territory outlines. Hover is display-only.
// `viewWidth` / `viewHeight` are the fixed map coordinates (paths stay in this space across resizes).
// `svgWidth` / `svgHeight` are the on-screen pixel size; the viewBox scales the map into that box.
// `blinkBright` is `{ player, ai }`: that side's gems use lighter opaque facets while its own flash is on the bright half.
// `playerBoundary` / `aiBoundary` are outline segments `{ a, b, shared }` from `regionBoundary`.
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
}) => {
  // One screen pixel in map units. The viewBox is scaled uniformly into the svg element.
  const pixelInUnits = svgWidth > 0 ? viewWidth / svgWidth : 1;
  // Black stroke: acid core plus one screen pixel of black on each side.
  const territoryBlackWidth = TERRITORY_STROKE_WIDTH + pixelInUnits * TERRITORY_RIM_PX * 2;
  return (
    <svg
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      width={svgWidth}
      height={svgHeight}
      style={{ background: '#1a1a1a', display: 'block' }}
    >
      <defs>
        {/* Bloom behind the black rim, so the acid edge still reads on busy gems. */}
        <filter
          id="territory-strike"
          filterUnits="userSpaceOnUse"
          x={-12}
          y={-12}
          width={viewWidth + 24}
          height={viewHeight + 24}
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="3.6" result="bloom" />
          <feComponentTransfer in="bloom" result="hot">
            <feFuncA type="linear" slope="2" />
          </feComponentTransfer>
        </filter>
      </defs>
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
      <TerritoryOutline
        segments={playerBoundary}
        color={PLAYER_BOUNDARY_STROKE}
        keyPrefix="p-boundary"
        outlineWidth={territoryBlackWidth}
      />
      <TerritoryOutline
        segments={aiBoundary}
        color={AI_BOUNDARY_STROKE}
        keyPrefix="a-boundary"
        outlineWidth={territoryBlackWidth}
      />
    </svg>
  );
};

export default BoardSvg;
