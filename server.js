const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { Chess } = require("chess.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3001;
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const START_FEN = new Chess().fen();

function publicState(room) {
  return {
    code: room.code,
    fen: room.game.fen(),
    pgn: room.game.pgn(),
    turn: room.game.turn(),
    history: room.game.history({ verbose: true }).map(m => ({
      color: m.color, from: m.from, to: m.to, san: m.san,
      piece: m.piece, captured: m.captured || null, promotion: m.promotion || null
    })),
    players: {
      w: Boolean(room.players.w),
      b: Boolean(room.players.b)
    },
    ai: Boolean(room.ai),
    difficulty: room.difficulty || null,
    status: room.agreedDraw ? "draw-agreed"
      : room.resignedBy ? "resigned"
      : room.game.isCheckmate() ? "checkmate"
      : room.game.isStalemate() ? "stalemate"
      : room.game.isThreefoldRepetition() ? "draw-repetition"
      : room.game.isInsufficientMaterial() ? "draw-material"
      : room.game.isDraw() ? "draw"
      : room.game.isCheck() ? "check" : "playing",
    winner: room.resignedBy ? (room.resignedBy === "w" ? "b" : "w")
      : room.game.isCheckmate() ? (room.game.turn() === "w" ? "b" : "w") : null,
    drawOfferedBy: room.drawOfferedBy || null
  };
}
function emitState(room) {
  io.to(room.code).emit("state", publicState(room));
}
function cleanCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}
function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do { code = Array.from({length: 5}, () => chars[Math.floor(Math.random() * chars.length)]).join(""); }
  while (rooms.has(code));
  return code;
}
function roomForSocket(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}
function seatForSocket(room, socket) {
  if (room.players.w === socket.id) return "w";
  if (room.players.b === socket.id) return "b";
  return null;
}
function sendError(socket, message) { socket.emit("game-error", message); }

// Lightweight server-side chess AI. All moves are still validated by chess.js.
const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
function evaluatePosition(game) {
  if (game.isCheckmate()) return game.turn() === "w" ? 100000 : -100000;
  if (game.isDraw() || game.isStalemate() || game.isThreefoldRepetition() || game.isInsufficientMaterial()) return 0;
  let score = 0;
  const board = game.board();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const piece = board[r][c];
    if (!piece) continue;
    const sign = piece.color === "b" ? 1 : -1;
    const center = 3.5 - (Math.abs(3.5-r) + Math.abs(3.5-c))/2;
    let positional = 0;
    if (piece.type === "n" || piece.type === "b") positional += center * 9;
    if (piece.type === "p") positional += (piece.color === "b" ? r : 7-r) * 7 + center * 2;
    if (piece.type === "q") positional += center * 2;
    score += sign * (PIECE_VALUE[piece.type] + positional);
  }
  return score;
}
function orderedMoves(game) {
  return game.moves({ verbose: true }).sort((a, b) => {
    const score = m => (m.captured ? PIECE_VALUE[m.captured] * 10 - PIECE_VALUE[m.piece] : 0) + (m.promotion ? PIECE_VALUE[m.promotion] : 0);
    return score(b) - score(a);
  });
}
function minimax(game, depth, alpha, beta) {
  if (depth <= 0 || game.isGameOver()) return evaluatePosition(game);
  const maximizing = game.turn() === "b";
  let best = maximizing ? -Infinity : Infinity;
  for (const move of orderedMoves(game)) {
    const next = new Chess(game.fen());
    next.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
    const score = minimax(next, depth - 1, alpha, beta);
    if (maximizing) { best = Math.max(best, score); alpha = Math.max(alpha, best); }
    else { best = Math.min(best, score); beta = Math.min(beta, best); }
    if (beta <= alpha) break;
  }
  return best;
}
function chooseAiMove(room) {
  const depth = room.difficulty === "hard" ? 3 : room.difficulty === "medium" ? 2 : 1;
  const game = room.game;
  const moves = orderedMoves(game);
  if (!moves.length) return null;
  let bestScore = -Infinity, bestMoves = [];
  for (const move of moves) {
    const next = new Chess(game.fen());
    next.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
    const score = depth === 1 ? evaluatePosition(next) : minimax(next, depth - 1, -Infinity, Infinity);
    if (score > bestScore) { bestScore = score; bestMoves = [move]; }
    else if (score === bestScore) bestMoves.push(move);
  }
  // Easy mode deliberately chooses among several reasonable moves.
  const pool = room.difficulty === "easy" ? bestMoves.concat(moves.filter(m => !bestMoves.includes(m)).slice(0, 4)) : bestMoves;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return { from: chosen.from, to: chosen.to, ...(chosen.promotion ? { promotion: chosen.promotion } : {}) };
}
function scheduleAiMove(roomCode) {
  setTimeout(() => {
    const room = rooms.get(roomCode);
    if (!room || !room.ai || room.resignedBy || room.agreedDraw || room.game.isGameOver() || room.game.turn() !== "b") return;
    const move = chooseAiMove(room);
    if (!move) return;
    try {
      const played = room.game.move(move);
      io.to(room.code).emit("last-move", { from: played.from, to: played.to });
      emitState(room);
    } catch (err) {
      console.error("AI move failed:", err.message);
    }
  }, 350);
}

io.on("connection", socket => {
  socket.on("create-room", () => {
    const code = makeCode();
    const room = { code, game: new Chess(), players: { w: socket.id, b: null }, ai: false, drawOfferedBy: null, createdAt: Date.now() };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("joined", { code, color: "w" });
    emitState(room);
  });

  socket.on("create-ai-game", rawDifficulty => {
    const difficulty = ["easy", "medium", "hard"].includes(rawDifficulty) ? rawDifficulty : "medium";
    const code = makeCode();
    const room = { code, game: new Chess(), players: { w: socket.id, b: "AI" }, ai: true, difficulty, drawOfferedBy: null, createdAt: Date.now() };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("joined", { code, color: "w", mode: "ai", difficulty });
    emitState(room);
  });

  socket.on("join-room", rawCode => {
    const code = cleanCode(rawCode);
    const room = rooms.get(code);
    if (!room) return sendError(socket, "Room not found. Check the code or create a new room.");
    if (seatForSocket(room, socket)) {
      socket.emit("joined", { code, color: seatForSocket(room, socket) });
      emitState(room); return;
    }
    if (room.players.w && room.players.b) return sendError(socket, "This room is full. Ask for another room code.");
    const color = room.players.w ? "b" : "w";
    room.players[color] = socket.id;
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("joined", { code, color });
    io.to(code).emit("notice", `${color === "w" ? "White" : "Black"} joined the match.`);
    emitState(room);
  });

  socket.on("move", payload => {
    const room = roomForSocket(socket);
    if (!room) return sendError(socket, "Join a room before moving.");
    const color = seatForSocket(room, socket);
    if (!color) return sendError(socket, "You are spectating; only players can move.");
    if (room.agreedDraw || room.resignedBy || room.game.isGameOver()) return sendError(socket, "This game has ended. Start a new game.");
    if (room.game.turn() !== color) return sendError(socket, "It is not your turn.");
    if (!payload || typeof payload.from !== "string" || typeof payload.to !== "string") return;
    try {
      const move = room.game.move({
        from: payload.from, to: payload.to,
        ...(payload.promotion ? { promotion: payload.promotion } : {})
      });
      room.drawOfferedBy = null;
      io.to(room.code).emit("last-move", { from: move.from, to: move.to });
      emitState(room);
      if (room.ai && room.game.turn() === "b" && !room.game.isGameOver()) scheduleAiMove(room.code);
    } catch (_) {
      sendError(socket, "Illegal move. Try a highlighted legal square.");
    }
  });

  socket.on("offer-draw", () => {
    const room = roomForSocket(socket);
    if (!room || !seatForSocket(room, socket)) return;
    if (room.ai) return sendError(socket, "Draw offers are available in friend matches only.");
    const color = seatForSocket(room, socket);
    if (room.game.isGameOver()) return sendError(socket, "The game has already ended.");
    room.drawOfferedBy = color;
    io.to(room.code).emit("draw-offered", { by: color });
    emitState(room);
  });

  socket.on("respond-draw", accept => {
    const room = roomForSocket(socket);
    if (!room || !seatForSocket(room, socket)) return;
    const color = seatForSocket(room, socket);
    if (!room.drawOfferedBy || room.drawOfferedBy === color) return;
    if (accept) {
      room.agreedDraw = true;
      io.to(room.code).emit("game-over", { reason: "Draw agreed" });
      emitState(room);
    } else {
      room.drawOfferedBy = null;
      io.to(room.code).emit("notice", "Draw offer declined.");
      emitState(room);
    }
  });

  socket.on("resign", () => {
    const room = roomForSocket(socket);
    if (!room || !seatForSocket(room, socket)) return;
    const color = seatForSocket(room, socket);
    room.resignedBy = color;
    io.to(room.code).emit("game-over", { reason: `${color === "w" ? "White" : "Black"} resigned`, winner: color === "w" ? "b" : "w" });
    emitState(room);
  });

  socket.on("new-game", () => {
    const room = roomForSocket(socket);
    if (!room || !seatForSocket(room, socket)) return;
    room.game = new Chess();
    room.drawOfferedBy = null;
    room.agreedDraw = false;
    room.resignedBy = null;
    io.to(room.code).emit("notice", "A new game has started.");
    emitState(room);
  });

  socket.on("disconnect", () => {
    const room = roomForSocket(socket);
    if (!room) return;
    const color = seatForSocket(room, socket);
    if (color) {
      room.players[color] = null;
      io.to(room.code).emit("notice", `${color === "w" ? "White" : "Black"} disconnected. They can rejoin with the same room code.`);
      emitState(room);
    }
    socket.data.roomCode = null;
    // Keep rooms alive for reconnects; prune abandoned rooms after 2 hours.
  });
});

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (!room.players.w && !room.players.b && room.createdAt < cutoff) rooms.delete(code);
  }
}, 15 * 60 * 1000).unref();

server.listen(PORT, "0.0.0.0", () => console.log(`Shadow Chess Online listening on ${PORT}`));
