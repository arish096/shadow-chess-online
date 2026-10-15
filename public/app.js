const socket = io();
const $ = id => document.getElementById(id);
const PIECES = {
  wk:"♔", wq:"♕", wr:"♖", wb:"♗", wn:"♘", wp:"♙",
  bk:"♚", bq:"♛", br:"♜", bb:"♝", bn:"♞", bp:"♟"
};
const VALUES = {p:1,n:3,b:3,r:5,q:9,k:0};
let myColor = null, roomCode = null, gameState = null, gameMode = "friend", aiDifficulty = "medium", selected = null, legalTargets = [], flipped = false, lastMove = null, pendingPromotion = null, confirmAction = null, toastTimer = null;

function toast(msg) {
  const el = $("toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}
function setConnection(online) {
  $("connectionDot").classList.toggle("online", online);
  $("connectionText").textContent = online ? "Connected to arena" : "Reconnecting…";
}
socket.on("connect", () => setConnection(true));
socket.on("disconnect", () => setConnection(false));
socket.on("connect_error", () => setConnection(false));
socket.on("game-error", message => { $("lobbyError").textContent = message; toast(message); });
socket.on("notice", message => toast(message));
socket.on("joined", data => {
  roomCode = data.code; myColor = data.color;
  gameMode = data.mode || "friend"; aiDifficulty = data.difficulty || "medium";
  $("lobby").classList.add("hidden"); $("game").classList.remove("hidden");
  $("opponentName").textContent = gameMode === "ai" ? `Computer · ${aiDifficulty[0].toUpperCase()+aiDifficulty.slice(1)}` : "Opponent";
  $("roomLabel").textContent = `ROOM ${roomCode}`;
  $("shareCode").textContent = roomCode;
  $("selfName").textContent = `You · ${myColor === "w" ? "White" : "Black"}`;
  flipped = myColor === "b";
  renderBoard();
  toast(`Joined as ${myColor === "w" ? "White" : "Black"}.`);
});
socket.on("state", state => {
  if (roomCode && state.code !== roomCode) return;
  gameState = state; selected = null; legalTargets = [];
  renderBoard(); renderStatus(); renderMoves(); renderCaptured();
});
socket.on("last-move", move => { lastMove = move; renderBoard(); });
socket.on("draw-offered", ({by}) => {
  if (by === myColor) return toast("Draw offer sent.");
  showConfirm("Accept draw?", "Your opponent offered a draw. Agree to end the game as a draw?", () => socket.emit("respond-draw", true), () => socket.emit("respond-draw", false), "Accept draw");
});
socket.on("game-over", data => toast(data.reason || "Game over"));

$("createBtn").addEventListener("click", () => { $("lobbyError").textContent = ""; socket.emit("create-room"); });
$("aiBtn").addEventListener("click", () => { $("lobbyError").textContent = ""; socket.emit("create-ai-game", $("aiDifficulty").value); });
$("joinBtn").addEventListener("click", () => {
  $("lobbyError").textContent = "";
  const code = $("roomInput").value.trim();
  if (!code) return $("lobbyError").textContent = "Enter a room code first.";
  socket.emit("join-room", code);
});
$("roomInput").addEventListener("keydown", e => { if (e.key === "Enter") $("joinBtn").click(); });
$("roomInput").addEventListener("input", e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
$("copyBtn").addEventListener("click", copyInvite);
$("shareBtn").addEventListener("click", copyInvite);
async function copyInvite() {
  const invite = `${location.origin} — Join my Shadow Chess room: ${roomCode}`;
  try { await navigator.clipboard.writeText(invite); toast("Room invite copied. Send it to your opponent!"); }
  catch { toast(`Room code: ${roomCode}`); }
}
$("flipBtn").addEventListener("click", () => { flipped = !flipped; renderBoard(); });
$("drawBtn").addEventListener("click", () => {
  if (!gameState || !["playing", "check"].includes(gameState.status)) return toast("No active game to offer a draw.");
  socket.emit("offer-draw");
});
$("resignBtn").addEventListener("click", () => showConfirm("Resign match?", "Resigning will award the win to your opponent.", () => socket.emit("resign"), null, "Resign"));
$("newGameBtn").addEventListener("click", () => showConfirm("Start a new game?", "This resets the current board for both players.", () => socket.emit("new-game"), null, "New game"));
$("cancelConfirm").addEventListener("click", closeConfirm);
$("acceptConfirm").addEventListener("click", () => { const fn = confirmAction; closeConfirm(); if (fn) fn(); });
function showConfirm(title, text, onAccept, onCancel, actionLabel) {
  $("confirmTitle").textContent = title; $("confirmText").textContent = text;
  $("acceptConfirm").textContent = actionLabel || "Confirm";
  confirmAction = onAccept;
  $("confirmModal").classList.remove("hidden");
  $("cancelConfirm").onclick = () => { closeConfirm(); if (onCancel) onCancel(); };
}
function closeConfirm() { $("confirmModal").classList.add("hidden"); confirmAction = null; }

function parseFenBoard(fen) {
  const ranks = fen.split(" ")[0].split("/");
  return ranks.map(rank => {
    const row = [];
    for (const char of rank) {
      if (/\d/.test(char)) for (let i=0;i<Number(char);i++) row.push(null);
      else row.push({ type: char.toLowerCase(), color: char === char.toUpperCase() ? "w" : "b" });
    }
    return row;
  });
}
function squareName(row, col) { return "abcdefgh"[col] + (8-row); }
function findKing(board, color) {
  for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(board[r][c] && board[r][c].type==="k" && board[r][c].color===color) return [r,c];
  return null;
}
function renderBoard() {
  const boardEl = $("board"); if (!gameState) { boardEl.innerHTML = ""; return; }
  const board = parseFenBoard(gameState.fen);
  const rows = flipped ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  const cols = flipped ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  const king = gameState.status === "check" ? findKing(board, gameState.turn) : null;
  boardEl.innerHTML = "";
  for (const r of rows) for (const c of cols) {
    const piece = board[r][c], sq = squareName(r,c);
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = `square ${(r+c)%2===0?"light":"dark"}`;
    btn.setAttribute("role","gridcell"); btn.setAttribute("aria-label", `${sq}${piece ? ` ${piece.color==="w"?"white":"black"} ${piece.type}` : ""}`);
    if (selected === sq) btn.classList.add("selected");
    if (lastMove && (lastMove.from===sq || lastMove.to===sq)) btn.classList.add("last-move");
    if (king && king[0]===r && king[1]===c) btn.classList.add("check");
    if (legalTargets.includes(sq)) btn.classList.add("legal", piece ? "capture" : "empty-target");
    if (piece) {
      const span = document.createElement("span");
      span.className = `piece ${piece.color==="w"?"white":"black"}`;
      span.textContent = PIECES[piece.color+piece.type]; btn.appendChild(span);
    }
    btn.addEventListener("click", () => handleSquare(sq, piece));
    boardEl.appendChild(btn);
  }
}
function handleSquare(sq, piece) {
  if (!gameState || !myColor) return;
  if (!["playing", "check"].includes(gameState.status)) return toast("This game has ended. Start a new game.");
  if (gameState.turn !== myColor) return toast("Wait for your turn.");
  if (selected && legalTargets.includes(sq)) {
    const from = selected, to = sq;
    const fromRow = 8 - Number(from[1]), toRow = 8 - Number(to[1]);
    const movingPiece = parseFenBoard(gameState.fen)[fromRow]["abcdefgh".indexOf(from[0])];
    if (movingPiece && movingPiece.type === "p" && (toRow===0 || toRow===7)) {
      pendingPromotion = {from,to}; $("promotionModal").classList.remove("hidden"); return;
    }
    socket.emit("move", {from,to}); selected = null; legalTargets = []; renderBoard(); return;
  }
  if (piece && piece.color === myColor) {
    selected = sq;
    legalTargets = getLegalTargets(sq);
  } else { selected = null; legalTargets = []; }
  renderBoard();
}
function getLegalTargets(sq) {
  // Use chess.js in the browser for accurate legal-move highlights; server-side chess.js validates every move again.
  if (window.Chess) {
    try {
      const localGame = new window.Chess(gameState.fen);
      return localGame.moves({ square: sq, verbose: true }).map(move => move.to);
    } catch (_) {}
  }
  const board = parseFenBoard(gameState.fen), r = 8-Number(sq[1]), c = "abcdefgh".indexOf(sq[0]), p = board[r][c];
  if (!p || p.color !== myColor) return [];
  const candidates = [];
  const add = (rr,cc) => { if(rr<0||rr>7||cc<0||cc>7) return false; const t=board[rr][cc]; if(!t) { candidates.push(squareName(rr,cc)); return true; } if(t.color!==p.color) candidates.push(squareName(rr,cc)); return false; };
  const ray = dirs => { for(const [dr,dc] of dirs){let rr=r+dr,cc=c+dc;while(rr>=0&&rr<8&&cc>=0&&cc<8){if(!add(rr,cc))break;rr+=dr;cc+=dc;}} };
  if(p.type==="n"){for(const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])add(r+dr,c+dc);}
  if(p.type==="b")ray([[-1,-1],[-1,1],[1,-1],[1,1]]);
  if(p.type==="r")ray([[-1,0],[1,0],[0,-1],[0,1]]);
  if(p.type==="q")ray([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
  if(p.type==="k"){for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++)if(dr||dc)add(r+dr,c+dc);if(c===4){if((p.color==="w"&&r===7)||(p.color==="b"&&r===0)){if(board[r][5]===null&&board[r][6]===null)candidates.push(squareName(r,6));if(board[r][1]===null&&board[r][2]===null&&board[r][3]===null)candidates.push(squareName(r,2));}}}
  if(p.type==="p"){
    const dir=p.color==="w"?-1:1, start=p.color==="w"?6:1;
    if(r+dir>=0&&r+dir<8&&!board[r+dir][c]){candidates.push(squareName(r+dir,c));if(r===start&&!board[r+2*dir][c])candidates.push(squareName(r+2*dir,c));}
    for(const dc of [-1,1]){const rr=r+dir,cc=c+dc;if(rr>=0&&rr<8&&cc>=0&&cc<8){const t=board[rr][cc];if(t&&t.color!==p.color)candidates.push(squareName(rr,cc));}}
    // En-passant candidate: server will validate it; derive target from last move history.
    const hist=gameState.history||[];const last=hist[hist.length-1];
    if(last&&last.piece==="p"&&Math.abs(Number(last.from[1])-Number(last.to[1]))===2&&Number(last.to[1])===Number(sq[1])&&Math.abs("abcdefgh".indexOf(last.to[0])-c)===1){candidates.push(squareName(r+dir,"abcdefgh".indexOf(last.to[0])));}
  }
  return [...new Set(candidates)];
}
document.querySelectorAll("[data-piece]").forEach(btn => btn.addEventListener("click", () => {
  if (!pendingPromotion) return;
  socket.emit("move", {...pendingPromotion, promotion: btn.dataset.piece});
  pendingPromotion = null; $("promotionModal").classList.add("hidden"); selected=null; legalTargets=[]; renderBoard();
}));
function renderStatus() {
  if (!gameState) return;
  const {status,turn,players,winner,drawOfferedBy} = gameState;
  const both = players.w && players.b;
  $("opponentState").textContent = gameState.ai ? "Computer ready · Plays automatically" : both ? "Connected · Ready to play" : "Waiting to join…";
  $("selfState").textContent = turn===myColor ? "Your turn to move" : "Waiting for opponent";
  $("opponentTurn").classList.toggle("active", turn !== myColor && both && !["checkmate","stalemate","draw","draw-repetition","draw-material","draw-agreed","resigned"].includes(status));
  $("selfTurn").classList.toggle("active", turn === myColor && both && !["checkmate","stalemate","draw","draw-repetition","draw-material","draw-agreed","resigned"].includes(status));
  const info = {
    playing: [both ? (turn===myColor?"Your turn":gameState.ai?"Computer is thinking…":"Opponent's turn") : "Waiting for opponent", both ? (turn===myColor?"Make your move.":gameState.ai?"The computer is choosing its move.":"Hang tight while your opponent plays.") : "Share your room code to begin."],
    check: ["Check!", turn===myColor ? "Your king is under attack. Find a safe move." : "Your opponent's king is in check."],
    checkmate: ["Checkmate", `Checkmate. ${winner===myColor?"You win!":"Your opponent wins."}`],
    stalemate: ["Stalemate", "The game is a draw."],
    draw: ["Draw", "The game ended in a draw."],
    "draw-repetition": ["Draw by repetition", "The same position occurred three times."],
    "draw-material": ["Draw by insufficient material", "Neither side has enough material to checkmate."],
    "draw-agreed": ["Draw agreed", "Both players agreed to end the game as a draw."],
    "resigned": ["Resignation", winner===myColor ? "Your opponent resigned. You win!" : "You resigned. Your opponent wins."]
  }[status] || ["Game ended","The match has ended."];
  $("statusTitle").textContent = info[0]; $("statusDescription").textContent = info[1];
  $("statusOrb").style.color = status==="check"||status==="checkmate" ? "#f87171" : "#a78bfa";
  if (drawOfferedBy && drawOfferedBy!==myColor) $("statusDescription").textContent = "Your opponent has offered a draw.";
  $("drawBtn").disabled = Boolean(gameState.ai);
  $("drawBtn").title = gameState.ai ? "Draw offers are for friend matches" : "Offer draw";
}
function renderMoves() {
  const el=$("movesList"), history=gameState?.history||[];
  if (!history.length) {el.innerHTML='<div class="empty-moves"><span>♟</span><p>Your match moves will<br>appear here.</p></div>';return;}
  el.innerHTML="";
  for(let i=0;i<history.length;i+=2){
    const row=document.createElement("div");row.className="move-row";
    const n=document.createElement("span");n.className="move-number";n.textContent=`${Math.floor(i/2)+1}.`;
    const white=document.createElement("span");white.className="move-san";white.textContent=history[i]?.san||"";
    const black=document.createElement("span");black.className="move-san";black.textContent=history[i+1]?.san||"";
    if(i+2>=history.length) (history[i+1]||history[i]).san && (history[i+1] ? black : white).classList.add("latest");
    row.append(n,white,black);el.appendChild(row);
  }
  el.scrollTop=el.scrollHeight;
}
function renderCaptured() {
  const history=gameState?.history||[], white=[], black=[];
  for(const m of history){if(m.captured){const victimColor=m.color==="w"?"b":"w";(victimColor==="w"?white:black).push(PIECES[victimColor+m.captured]);}}
  $("capturedWhite").textContent=white.join(" ")||"—";
  $("capturedBlack").textContent=black.join(" ")||"—";
}
