export function createGame() {
  return {
    board: Array(9).fill(null),
    turnSymbol: "X",
    winnerSymbol: null,
    winningLine: [],
    moveCount: 0,
  };
}

const WINNING_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function makeMove(game, index, symbol) {
  if (!Number.isInteger(index) || index < 0 || index > 8) {
    throw new Error("INVALID_MOVE");
  }
  if (game.winnerSymbol || game.moveCount === 9) {
    throw new Error("GAME_OVER");
  }
  if (symbol !== game.turnSymbol) {
    throw new Error("NOT_YOUR_TURN");
  }
  if (game.board[index]) {
    throw new Error("CELL_OCCUPIED");
  }

  game.board[index] = symbol;
  game.moveCount += 1;

  const winningLine = WINNING_LINES.find((line) =>
    line.every((cell) => game.board[cell] === symbol),
  );

  if (winningLine) {
    game.winnerSymbol = symbol;
    game.winningLine = winningLine;
    return { finished: true, draw: false };
  }

  if (game.moveCount === 9) {
    return { finished: true, draw: true };
  }

  game.turnSymbol = symbol === "X" ? "O" : "X";
  return { finished: false, draw: false };
}
