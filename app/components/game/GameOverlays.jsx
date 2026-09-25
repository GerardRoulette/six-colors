'use client';

import { DIFFICULTIES } from '../../game/ai/difficulty';
import { OVERLAY_BUTTON_STYLE } from './chromeStyles';

// Game-over card (covers the board) plus the FAQ and difficulty dialogs (fixed over the page).
// `t` is the locale lookup. `controlStats` supplies the rounded percents on the win card.
// `onTryAgain` starts a new match. FAQ and difficulty each have their own open flag and close handler.
// `difficulty` is the active level id; `onChooseDifficulty` persists a level and may restart.
const GameOverlays = ({
  t,
  gameOver,
  controlStats,
  onTryAgain,
  faqOpen,
  onCloseFaq,
  difficultyOpen,
  onCloseDifficulty,
  difficulty,
  onChooseDifficulty,
}) => (
  <>
    {gameOver && (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.55)',
        }}
      >
        <div
          style={{
            background: 'white',
            borderRadius: 12,
            padding: '28px 36px',
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
            minWidth: 280,
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>
            {gameOver === 'tie' ? t('gameOver.tie') : gameOver === 'player' ? t('gameOver.playerWins') : t('gameOver.aiWins')}
          </div>
          <div style={{ fontSize: 16, lineHeight: 1.6, color: '#333', marginBottom: 20 }}>
            <div>{t('stats.playerControls', { percent: controlStats.playerPercent })}</div>
            <div>{t('stats.aiControls', { percent: controlStats.aiPercent })}</div>
          </div>
          <button
            type="button"
            onClick={onTryAgain}
            style={OVERLAY_BUTTON_STYLE}
          >
            {t('button.tryAgain')}
          </button>
        </div>
      </div>
    )}
    {faqOpen && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="faq-title"
        onClick={onCloseFaq}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.55)',
        }}
      >
        <div
          onClick={(event) => {
            // Clicks on the card must not count as backdrop dismiss.
            event.stopPropagation();
          }}
          style={{
            background: 'white',
            color: '#171717',
            borderRadius: 12,
            padding: '28px 36px',
            textAlign: 'left',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
            minWidth: 280,
            maxWidth: 520,
            maxHeight: '80vh',
            overflow: 'auto',
          }}
        >
          <div id="faq-title" style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>
            {t('rules.title')}
          </div>
          <div style={{ fontSize: 16, lineHeight: 1.6, color: '#333', marginBottom: 12 }}>
            {t('rules.welcome')}
          </div>
          <div style={{ fontSize: 16, lineHeight: 1.6, color: '#333', marginBottom: 20 }}>
            {t('rules.howToPlay')}
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.6, color: '#555', marginBottom: 20 }}>
            {t('rules.constraints')}
          </div>
          <button
            type="button"
            onClick={onCloseFaq}
            style={OVERLAY_BUTTON_STYLE}
          >
            {t('button.close')}
          </button>
        </div>
      </div>
    )}
    {difficultyOpen && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="difficulty-title"
        aria-describedby="difficulty-restart-notice"
        onClick={onCloseDifficulty}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.55)',
        }}
      >
        <div
          onClick={(event) => {
            // Clicks on the card must not count as backdrop dismiss.
            event.stopPropagation();
          }}
          style={{
            background: 'white',
            color: '#171717',
            borderRadius: 12,
            padding: '28px 36px',
            textAlign: 'left',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
            minWidth: 280,
            maxWidth: 420,
          }}
        >
          <div id="difficulty-title" style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>
            {t('difficulty.title')}
          </div>
          <div
            id="difficulty-restart-notice"
            style={{ fontSize: 14, lineHeight: 1.5, color: '#555', marginBottom: 16 }}
          >
            {t('difficulty.restartNotice')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {DIFFICULTIES.map((level) => {
              // Whether this row is the currently saved AI level (pressed styling + aria-pressed).
              const active = difficulty === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => onChooseDifficulty(level)}
                  aria-pressed={active}
                  style={{
                    ...OVERLAY_BUTTON_STYLE,
                    width: '100%',
                    opacity: active ? 1 : 0.7,
                    outline: active ? '2px solid #171717' : '2px solid transparent',
                    outlineOffset: 2,
                  }}
                >
                  {t(`difficulty.${level}`)}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onCloseDifficulty}
            style={OVERLAY_BUTTON_STYLE}
          >
            {t('button.close')}
          </button>
        </div>
      </div>
    )}
  </>
);

export default GameOverlays;
