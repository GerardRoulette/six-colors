'use client';

import { PALETTE } from '../../game/moves';

// Space between adjacent palette swatches (px).
const PALETTE_GAP = 4;
// Default palette button edge; shrinks on narrow screens so six swatches stay on one row.
const PALETTE_BUTTON_MAX = 64;

// Six color swatches under the board. Illegal or out-of-turn colors are dimmed and crossed out.
// `svgWidth` is the board width the row must fit. `legalColors` is the player's current legal palette.
// `interactionLocked` is true when it is not the player's turn or the match is over.
// `onChoose` receives a palette CSS name when an enabled swatch is clicked.
const PaletteBar = ({ svgWidth, legalColors, interactionLocked, onChoose }) => {
  // Swatch edge so PALETTE.length buttons plus gaps fit the board width, capped at PALETTE_BUTTON_MAX.
  const paletteButtonSize = Math.min(
    PALETTE_BUTTON_MAX,
    Math.max(1, Math.floor((svgWidth - PALETTE_GAP * (PALETTE.length - 1)) / PALETTE.length)),
  );

  return (
    <div style={{ display: 'flex', gap: PALETTE_GAP, flexWrap: 'nowrap', justifyContent: 'center', width: svgWidth, maxWidth: '100%', boxSizing: 'border-box' }}>
      {PALETTE.map((c) => {
        // Grey + X when it is not the player's turn, the match ended, or this color is banned.
        const disabled = interactionLocked || !legalColors.includes(c);
        return (
          <button
            key={c}
            onClick={() => onChoose(c)}
            disabled={disabled}
            style={{
              width: paletteButtonSize,
              height: paletteButtonSize,
              flex: '0 0 auto',
              padding: 0,
              boxSizing: 'border-box',
              borderRadius: 4,
              border: '1px solid #333',
              background: c,
              opacity: disabled ? 0.4 : 1,
            }}
          >
            {disabled && (
              <svg
                viewBox="0 0 64 32"
                preserveAspectRatio="none"
                style={{
                  position: 'relative',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  display: 'block',
                  pointerEvents: 'none',
                }}
              >
                <line x1="0" y1="0" x2="64" y2="32" stroke="black" strokeWidth="7" strokeLinecap="round" />
                <line x1="64" y1="0" x2="0" y2="32" stroke="black" strokeWidth="7" strokeLinecap="round" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default PaletteBar;
