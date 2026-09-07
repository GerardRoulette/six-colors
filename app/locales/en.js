const en = {
    gameOver: {
      tie: "It's a tie!",
      playerWins: "Player wins!",
      aiWins: "AI wins!",
    },
    stats: {
      playerControls: "Player controls {percent}%",
      aiControls: "AI controls {percent}%",
    },
    button: {
      tryAgain: "Try again",
      faq: "FAQ",
      difficulty: "Difficulty",
      close: "Close",
    },
    status: {
      gameOver: "Game over",
      yourTurn: "Your turn",
      aiThinking: "AI thinking…",
    },
    rules: {
      title: "How to play",
      constraints: "Constraints: not your previous color, not AI last color, not either starting color (for the first move).",
      welcome: "Welcome to the game of Six Colours! This is a game of strategy and luck based on controlling the most cells on the board. To win, you need to control more than 50% of the cells. To do this, you need to choose a color that is not your previous color, not the AI's last color, and not either starting color (for the first move).",
      howToPlay: "How to play: pick a color from the palette (not by clicking cells). Your territory grows through neighboring unowned cells of that color. The AI then picks a color. The game continues until one side controls more than 50% of the cells, or until there are no more captures left.",
    },
    difficulty: {
      title: "Difficulty",
      easy: "Easy",
      medium: "Medium",
      hard: "Hard",
      restartNotice: "Changing the difficulty starts a new game.",
    },
  };
  
  export default en;