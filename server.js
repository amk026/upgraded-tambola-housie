const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Catch-all to serve index.html for client-side routing
app.get("/*path", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Game State ----------
let gameState = {
  // Basic Info
  gameName: "",
  visibleToPlayers: true,

  // Tickets
  tickets: [],

  // Called numbers & draw
  calledNumbers: [],
  drawSequence: [],
  drawIndex: 0,
  customDrawSequence: null, // custom order set by host

  // Prize categories
  prizeCategories: [],

  // Winners
  winners: [],
  fullHousieWinners: [],

  // Game status & timers
  status: "NO_ACTIVE_GAME",
  gameCreatedAt: null,
  gameStartedAt: null,
  gameEndedAt: null,
  countdownEndTime: null,
  lastCallTime: null,
  gameEndReason: null,

  // Scheduling
  scheduledStartTime: null,
  countdownPaused: false,
  pausedDuration: 0,
  pauseStartTime: null,

  // WhatsApp configuration
  whatsappConfig: [], // { start: number, end: number, number: string, primary: boolean }

  // Legacy fields
  maxWinners: 5,
  currentPrizeRank: 1,

  // Settings
  allowMultipleWinsPerTicket: false,
  // *** NEW: allow multiple tickets to win the same prize simultaneously ***
  allowMultipleWinnersPerPrize: true,
};

let nextCallTimeout = null;
let countdownTimeout = null;
let scheduledStartTimeout = null;

// ---------- Helper Functions ----------
function broadcastState() {
  console.log(
    "📢 Broadcasting gameState, whatsappConfig:",
    gameState.whatsappConfig,
  );
  io.emit("gameState", gameState);
}

// Tambola ticket generator (unchanged)
const TambolaGenerator = {
  generateTicket() {
    const MAX_ATTEMPTS = 100;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let colCounts = new Array(9).fill(1);
      let remaining = 6;
      while (remaining > 0) {
        let col = Math.floor(Math.random() * 9);
        if (colCounts[col] < 3) {
          colCounts[col]++;
          remaining--;
        }
      }
      let ticket = Array(3)
        .fill()
        .map(() => Array(9).fill(0));
      let rowRemaining = [5, 5, 5];
      let colRemaining = [...colCounts];
      let placed = 0;
      while (placed < 15) {
        let rowsWithSpace = [];
        for (let r = 0; r < 3; r++) {
          if (rowRemaining[r] > 0) rowsWithSpace.push(r);
        }
        if (rowsWithSpace.length === 0) break;
        let r = rowsWithSpace[Math.floor(Math.random() * rowsWithSpace.length)];
        let validCols = [];
        for (let c = 0; c < 9; c++) {
          if (colRemaining[c] > 0 && ticket[r][c] === 0) validCols.push(c);
        }
        if (validCols.length === 0) break;
        let c = validCols[Math.floor(Math.random() * validCols.length)];
        ticket[r][c] = 1;
        rowRemaining[r]--;
        colRemaining[c]--;
        placed++;
      }
      if (placed === 15) {
        const ranges = [
          [1, 9],
          [10, 19],
          [20, 29],
          [30, 39],
          [40, 49],
          [50, 59],
          [60, 69],
          [70, 79],
          [80, 90],
        ];
        for (let c = 0; c < 9; c++) {
          let rows = [];
          for (let r = 0; r < 3; r++) {
            if (ticket[r][c] === 1) rows.push(r);
          }
          if (rows.length === 0) continue;
          let [min, max] = ranges[c];
          let pool = [];
          for (let n = min; n <= max; n++) pool.push(n);
          for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
          let numbers = pool.slice(0, rows.length).sort((a, b) => a - b);
          for (let i = 0; i < rows.length; i++) {
            ticket[rows[i]][c] = numbers[i];
          }
        }
        return ticket;
      }
    }
    throw new Error("Failed to generate a valid ticket after many attempts");
  },

  generateTickets(count) {
    let tickets = [];
    for (let i = 1; i <= count; i++) {
      tickets.push({
        id: `T-${i.toString().padStart(2, "0")}`,
        numbers: this.generateTicket(),
        isBooked: false,
        bookedBy: null,
        isPending: false,
        pendingPlayerName: null,
        isFullHousieWinner: false,
        fullHousieOrder: null,
        winTime: null,
        winningPattern: null,
      });
    }
    return tickets;
  },
};

// ---------- Pattern Checkers (unchanged) ----------
function checkEarlyFive(ticketNumbers, calledNumbers) {
  const flat = ticketNumbers.flat().filter((n) => n !== 0);
  const markedCount = flat.filter((n) => calledNumbers.includes(n)).length;
  return markedCount >= 5;
}

function checkTopLine(ticketNumbers, calledNumbers) {
  const topRow = ticketNumbers[0].filter((n) => n !== 0);
  return topRow.every((n) => calledNumbers.includes(n));
}

function checkMiddleLine(ticketNumbers, calledNumbers) {
  const middleRow = ticketNumbers[1].filter((n) => n !== 0);
  return middleRow.every((n) => calledNumbers.includes(n));
}

function checkBottomLine(ticketNumbers, calledNumbers) {
  const bottomRow = ticketNumbers[2].filter((n) => n !== 0);
  return bottomRow.every((n) => calledNumbers.includes(n));
}

function checkFullHouse(ticketNumbers, calledNumbers) {
  const flat = ticketNumbers.flat().filter((n) => n !== 0);
  return flat.every((n) => calledNumbers.includes(n));
}

function checkCorners(ticketNumbers, calledNumbers) {
  const getRowExtremes = (row) => {
    const numbersInRow = row.filter((n) => n !== 0);
    return {
      first: numbersInRow[0],
      last: numbersInRow[numbersInRow.length - 1],
    };
  };

  const top = getRowExtremes(ticketNumbers[0]);
  const bottom = getRowExtremes(ticketNumbers[2]);

  return (
    calledNumbers.includes(top.first) &&
    calledNumbers.includes(top.last) &&
    calledNumbers.includes(bottom.first) &&
    calledNumbers.includes(bottom.last)
  );
}

const patternCheckers = {
  "Early Five": checkEarlyFive,
  "Top Line": checkTopLine,
  "Middle Line": checkMiddleLine,
  "Bottom Line": checkBottomLine,
  "Full House": checkFullHouse,
  Corners: checkCorners,
};

// ---------- Winner Detection (UPDATED with allowMultipleWinnersPerPrize) ----------
function checkForWinners() {
  if (gameState.status !== "RUNNING") return;

  for (const category of gameState.prizeCategories) {
    const pattern = category.name;
    const checker = patternCheckers[pattern];
    if (!checker) continue;

    let eligibleTickets = gameState.tickets.filter((t) => t.isBooked);

    if (!gameState.allowMultipleWinsPerTicket) {
      eligibleTickets = eligibleTickets.filter(
        (t) => !gameState.winners.some((w) => w.ticketId === t.id),
      );
    } else {
      eligibleTickets = eligibleTickets.filter(
        (t) =>
          !gameState.winners.some(
            (w) => w.ticketId === t.id && w.pattern === pattern,
          ),
      );
    }

    const newlyCompleted = eligibleTickets.filter((t) =>
      checker(t.numbers, gameState.calledNumbers),
    );

    if (newlyCompleted.length === 0) continue;

    // Find the first un-awarded prize in this category
    const prize = category.prizes.find((p) => !p.awarded);
    if (!prize) continue;

    // *** NEW: Respect allowMultipleWinnersPerPrize ***
    if (gameState.allowMultipleWinnersPerPrize) {
      // Award the SAME prize to EVERY ticket that just completed the pattern
      newlyCompleted.forEach((ticket) => {
        declareWinner(ticket, pattern, prize);
      });
      prize.awarded = true;
    } else {
      // Only one winner gets the prize (pick the first)
      const winnerTicket = newlyCompleted[0];
      declareWinner(winnerTicket, pattern, prize);
      prize.awarded = true;
    }
  }
}

function declareWinner(ticket, pattern, prize) {
  const winner = {
    pattern,
    prizeTitle: prize.title,
    prizeAmount: prize.amount,
    ticketId: ticket.id,
    playerName: ticket.bookedBy,
    winTime: new Date().toLocaleTimeString(),
    winTimestamp: Date.now(),
    calledNumbersAtWin: [...gameState.calledNumbers],
  };
  gameState.winners.push(winner);

  if (pattern === "Full House") {
    gameState.fullHousieWinners.push({
      order: gameState.fullHousieWinners.length + 1,
      ticketId: ticket.id,
      playerName: ticket.bookedBy,
      pattern: "FULL HOUSIE",
      winTime: winner.winTime,
      winTimestamp: winner.winTimestamp,
      ticketNumbers: ticket.numbers,
      calledNumbersAtWin: winner.calledNumbersAtWin,
    });
  }

  console.log(
    `🏆 WINNER: ${ticket.bookedBy} (${ticket.id}) - ${pattern} - ${prize.title}`,
  );
  io.emit("newWinner", winner);
  broadcastState();
}

// ---------- Game Flow (unchanged) ----------
function startCountdown(seconds) {
  gameState.status = "COUNTDOWN";
  gameState.countdownEndTime = Date.now() + seconds * 1000;
  gameState.gameStartedAt = null;
  gameState.drawIndex = 0;
  broadcastState();

  countdownTimeout = setTimeout(() => {
    if (gameState.status === "COUNTDOWN") {
      actuallyStartGame();
    }
  }, seconds * 1000);
}

function actuallyStartGame() {
  let drawSequence = [];
  const custom = gameState.customDrawSequence;
  if (custom && Array.isArray(custom) && custom.length === 90) {
    const sorted = [...custom].sort((a, b) => a - b);
    let valid = true;
    for (let i = 0; i < 90; i++) {
      if (sorted[i] !== i + 1) {
        valid = false;
        break;
      }
    }
    if (valid) {
      drawSequence = custom;
      console.log("🎲 Using custom draw order");
    } else {
      console.warn("⚠️ Invalid custom draw order, falling back to random");
    }
  }

  if (drawSequence.length === 0) {
    const nums = Array.from({ length: 90 }, (_, i) => i + 1);
    for (let i = nums.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    drawSequence = nums;
  }

  gameState.drawSequence = drawSequence;
  gameState.drawIndex = 0;
  gameState.customDrawSequence = null;

  gameState.status = "RUNNING";
  gameState.gameStartedAt = Date.now();
  gameState.countdownEndTime = null;
  gameState.lastCallTime = Date.now();
  broadcastState();
  scheduleNextCall();
}

function scheduleNextCall() {
  if (gameState.status !== "RUNNING") return;

  if (allPrizesAwarded()) {
    endGame("ALL_PRIZES_AWARDED");
    return;
  }

  if (gameState.drawIndex >= gameState.drawSequence.length) {
    endGame("SEQUENCE_COMPLETE");
    return;
  }

  const now = Date.now();
  const timeUntilNextCall = Math.max(0, 6000 - (now - gameState.lastCallTime));
  nextCallTimeout = setTimeout(() => {
    if (gameState.status !== "RUNNING") return;

    const number = gameState.drawSequence[gameState.drawIndex++];
    if (!gameState.calledNumbers.includes(number)) {
      gameState.calledNumbers.push(number);
    }
    gameState.lastCallTime = Date.now();

    checkForWinners();

    broadcastState();
    scheduleNextCall();
  }, timeUntilNextCall);
}

function allPrizesAwarded() {
  for (const cat of gameState.prizeCategories) {
    for (const prize of cat.prizes) {
      if (!prize.awarded) return false;
    }
  }
  return true;
}

function endGame(reason) {
  gameState.status = "COMPLETED";
  gameState.gameEndedAt = Date.now();
  gameState.gameEndReason = reason;
  clearTimeouts();
  broadcastState();
}

function clearTimeouts() {
  if (nextCallTimeout) {
    clearTimeout(nextCallTimeout);
    nextCallTimeout = null;
  }
  if (countdownTimeout) {
    clearTimeout(countdownTimeout);
    countdownTimeout = null;
  }
  if (scheduledStartTimeout) {
    clearTimeout(scheduledStartTimeout);
    scheduledStartTimeout = null;
  }
}

function resetGame() {
  gameState = {
    gameName: "",
    visibleToPlayers: true,
    tickets: [],
    calledNumbers: [],
    prizeCategories: [],
    winners: [],
    fullHousieWinners: [],
    status: "NO_ACTIVE_GAME",
    drawSequence: [],
    drawIndex: 0,
    customDrawSequence: null,
    gameCreatedAt: null,
    gameStartedAt: null,
    gameEndedAt: null,
    countdownEndTime: null,
    lastCallTime: null,
    scheduledStartTime: null,
    countdownPaused: false,
    pausedDuration: 0,
    pauseStartTime: null,
    maxWinners: 5,
    currentPrizeRank: 1,
    gameEndReason: null,
    whatsappConfig: [],
    allowMultipleWinsPerTicket: false,
    allowMultipleWinnersPerPrize: true, // *** NEW ***
  };
  clearTimeouts();
  broadcastState();
}

// ---------- Socket.IO ----------
io.on("connection", (socket) => {
  console.log("a user connected");
  console.log("Current WhatsApp config:", gameState.whatsappConfig);
  socket.emit("gameState", gameState);

  socket.on("host:login", ({ username, password }) => {
    console.log("Login attempt:", username);
    if (username === "admin" && password === "myNewSecret") {
      socket.isHost = true;
      console.log("Login successful for:", username);
      socket.emit("host:login:success", { message: "Login successful" });
    } else {
      console.log("Login failed for:", username);
      socket.emit("host:login:failure", { message: "Invalid credentials" });
    }
  });

  const requireHost = (callback) => {
    if (!socket.isHost) {
      socket.emit("host:error", { message: "Not authenticated" });
      return false;
    }
    return true;
  };

  socket.on(
    "host:createGameWithConfig",
    ({ gameName, ticketCount, prizeCategories }) => {
      if (!requireHost()) return;
      const tickets = TambolaGenerator.generateTickets(ticketCount);
      prizeCategories.forEach((cat) => {
        cat.prizes.forEach((prize) => {
          prize.awarded = false;
        });
      });
      gameState = {
        ...gameState,
        gameName,
        visibleToPlayers: true,
        tickets,
        prizeCategories,
        calledNumbers: [],
        winners: [],
        fullHousieWinners: [],
        drawSequence: [],
        drawIndex: 0,
        customDrawSequence: null,
        status: "BOOKING_OPEN",
        gameCreatedAt: Date.now(),
        gameStartedAt: null,
        gameEndedAt: null,
        countdownEndTime: null,
        lastCallTime: null,
        scheduledStartTime: null,
        countdownPaused: false,
        pausedDuration: 0,
        pauseStartTime: null,
        maxWinners: prizeCategories.reduce(
          (acc, cat) => acc + cat.prizes.length,
          0,
        ),
        currentPrizeRank: 1,
        gameEndReason: null,
        whatsappConfig: gameState.whatsappConfig || [],
        allowMultipleWinsPerTicket: gameState.allowMultipleWinsPerTicket,
        allowMultipleWinnersPerPrize: gameState.allowMultipleWinnersPerPrize, // preserve
      };
      broadcastState();
    },
  );

  socket.on("host:updateWhatsappConfig", ({ config }) => {
    if (!requireHost()) return;
    // Validate: only one primary allowed
    const primaryCount = config.filter((r) => r.primary).length;
    if (primaryCount > 1) {
      socket.emit("host:error", { message: "Only one primary number allowed" });
      return;
    }
    console.log("📲 Updating WhatsApp config on server:", config);
    gameState.whatsappConfig = config;
    broadcastState();
  });

  socket.on("host:setCustomDrawOrder", ({ sequence }) => {
    if (!requireHost()) return;
    if (!Array.isArray(sequence)) {
      socket.emit("host:error", { message: "Invalid sequence format" });
      return;
    }
    gameState.customDrawSequence = sequence;
    broadcastState();
    socket.emit("host:customDrawOrderSet", { success: true });
  });

  // *** UPDATED: host:updateSettings now also handles allowMultipleWinnersPerPrize ***
  socket.on(
    "host:updateSettings",
    ({ allowMultipleWinsPerTicket, allowMultipleWinnersPerPrize }) => {
      if (!requireHost()) return;
      if (allowMultipleWinsPerTicket !== undefined) {
        gameState.allowMultipleWinsPerTicket = allowMultipleWinsPerTicket;
      }
      if (allowMultipleWinnersPerPrize !== undefined) {
        gameState.allowMultipleWinnersPerPrize = allowMultipleWinnersPerPrize;
      }
      broadcastState();
      socket.emit("host:settingsUpdated", { success: true });
    },
  );

  // Batch delete unbooked tickets
  socket.on("host:deleteTickets", ({ ticketIds }) => {
    if (!requireHost()) return;
    if (gameState.status !== "BOOKING_OPEN") {
      socket.emit("host:error", { message: "Cannot delete tickets now" });
      return;
    }
    const toDelete = ticketIds.filter((id) => {
      const t = gameState.tickets.find((t) => t.id === id);
      return t && !t.isBooked && !t.isPending && !t.isFullHousieWinner;
    });
    gameState.tickets = gameState.tickets.filter(
      (t) => !toDelete.includes(t.id),
    );
    broadcastState();
    socket.emit("host:ticketsDeleted", {
      success: true,
      count: toDelete.length,
    });
  });

  socket.on("host:deleteAllUnbookedTickets", () => {
    if (!requireHost()) return;
    if (gameState.status !== "BOOKING_OPEN") {
      socket.emit("host:error", { message: "Cannot delete tickets now" });
      return;
    }
    gameState.tickets = gameState.tickets.filter(
      (t) => t.isBooked || t.isPending || t.isFullHousieWinner,
    );
    broadcastState();
    socket.emit("host:ticketsDeleted", {
      success: true,
      count: "all unbooked",
    });
  });

  socket.on("host:cancelPendingTickets", ({ ticketIds }) => {
    if (!requireHost()) return;
    if (gameState.status !== "BOOKING_OPEN") {
      socket.emit("host:error", { message: "Cannot cancel pending now" });
      return;
    }
    gameState.tickets.forEach((t) => {
      if (ticketIds.includes(t.id) && t.isPending && !t.isFullHousieWinner) {
        t.isPending = false;
        t.pendingPlayerName = null;
      }
    });
    broadcastState();
    socket.emit("host:pendingCancelled", { success: true });
  });

  socket.on("host:cancelAllPendingTickets", () => {
    if (!requireHost()) return;
    if (gameState.status !== "BOOKING_OPEN") {
      socket.emit("host:error", { message: "Cannot cancel pending now" });
      return;
    }
    gameState.tickets.forEach((t) => {
      if (t.isPending && !t.isFullHousieWinner) {
        t.isPending = false;
        t.pendingPlayerName = null;
      }
    });
    broadcastState();
    socket.emit("host:pendingCancelled", { success: true, all: true });
  });

  // Legacy delete ticket (single)
  socket.on("host:deleteTicket", ({ ticketId }) => {
    if (!requireHost()) return;
    if (gameState.status !== "BOOKING_OPEN") {
      socket.emit("host:error", { message: "Cannot delete tickets now" });
      return;
    }
    const index = gameState.tickets.findIndex((t) => t.id === ticketId);
    if (index === -1) {
      socket.emit("host:error", { message: "Ticket not found" });
      return;
    }
    const ticket = gameState.tickets[index];
    if (ticket.isBooked || ticket.isPending || ticket.isFullHousieWinner) {
      socket.emit("host:error", {
        message: "Only unbooked tickets can be deleted",
      });
      return;
    }
    gameState.tickets.splice(index, 1);
    broadcastState();
    socket.emit("host:ticketDeleted", { success: true, ticketId });
  });

  // Legacy create game
  socket.on("host:createGame", ({ ticketCount, maxWinners }) => {
    if (!requireHost()) return;
    const tickets = TambolaGenerator.generateTickets(ticketCount);
    const prizeCategories = [
      {
        name: "Full House",
        prizes: Array.from({ length: maxWinners || 5 }, (_, i) => ({
          title: `Prize ${i + 1}`,
          description: "",
          amount: 0,
          awarded: false,
        })),
      },
    ];
    gameState = {
      ...gameState,
      gameName: "Tambola Game",
      visibleToPlayers: true,
      tickets,
      prizeCategories,
      calledNumbers: [],
      winners: [],
      fullHousieWinners: [],
      drawSequence: [],
      drawIndex: 0,
      customDrawSequence: null,
      status: "BOOKING_OPEN",
      gameCreatedAt: Date.now(),
      gameStartedAt: null,
      gameEndedAt: null,
      countdownEndTime: null,
      lastCallTime: null,
      scheduledStartTime: null,
      countdownPaused: false,
      pausedDuration: 0,
      pauseStartTime: null,
      maxWinners: maxWinners || 5,
      currentPrizeRank: 1,
      gameEndReason: null,
      whatsappConfig: gameState.whatsappConfig || [],
      allowMultipleWinsPerTicket: gameState.allowMultipleWinsPerTicket,
      allowMultipleWinnersPerPrize: gameState.allowMultipleWinnersPerPrize,
    };
    broadcastState();
  });

  socket.on("host:scheduleCountdown", ({ scheduledTime }) => {
    if (!requireHost()) return;
    if (gameState.status !== "BOOKING_OPEN") return;
    gameState.scheduledStartTime = scheduledTime;
    const delay = scheduledTime - Date.now();
    if (delay > 0) {
      scheduledStartTimeout = setTimeout(() => {
        if (gameState.status === "BOOKING_OPEN") {
          startCountdown(30);
        }
      }, delay);
    }
    broadcastState();
  });

  socket.on("host:pauseCountdown", () => {
    if (!requireHost()) return;
    if (gameState.status === "COUNTDOWN" && !gameState.countdownPaused) {
      gameState.countdownPaused = true;
      gameState.pauseStartTime = Date.now();
      clearTimeout(countdownTimeout);
      broadcastState();
    }
  });

  socket.on("host:resumeCountdown", () => {
    if (!requireHost()) return;
    if (gameState.status === "COUNTDOWN" && gameState.countdownPaused) {
      const pausedFor = Date.now() - gameState.pauseStartTime;
      gameState.countdownEndTime += pausedFor;
      gameState.countdownPaused = false;
      gameState.pauseStartTime = null;
      const remaining = Math.max(0, gameState.countdownEndTime - Date.now());
      countdownTimeout = setTimeout(() => {
        if (gameState.status === "COUNTDOWN") actuallyStartGame();
      }, remaining);
      broadcastState();
    }
  });

  socket.on("host:startCountdown", ({ duration }) => {
    if (!requireHost()) return;
    if (
      gameState.status === "BOOKING_OPEN" &&
      gameState.tickets.filter((t) => t.isBooked).length > 0
    ) {
      let seconds = 30;
      if (typeof duration === "number") seconds = duration;
      else if (typeof duration === "string") {
        if (duration.endsWith("m")) seconds = parseInt(duration) * 60;
        else seconds = parseInt(duration);
      }
      seconds = Math.max(5, Math.min(300, seconds));
      if (scheduledStartTimeout) {
        clearTimeout(scheduledStartTimeout);
        scheduledStartTimeout = null;
      }
      gameState.scheduledStartTime = null;
      startCountdown(seconds);
    }
  });

  socket.on("host:resetGame", () => {
    if (!requireHost()) return;
    resetGame();
  });

  // Booking handlers
  socket.on("host:bookTicket", ({ ticketId, playerName }) => {
    if (!requireHost()) return;
    if (gameState.status !== "BOOKING_OPEN") {
      socket.emit("host:error", { message: "Bookings closed" });
      return;
    }
    const ticket = gameState.tickets.find((t) => t.id === ticketId);
    if (
      ticket &&
      !ticket.isBooked &&
      !ticket.isFullHousieWinner &&
      !ticket.isPending
    ) {
      ticket.isBooked = true;
      ticket.bookedBy = playerName;
      broadcastState();
    }
  });

  socket.on("host:editBooking", ({ ticketId, newPlayerName }) => {
    if (!requireHost()) return;
    if (gameState.status !== "BOOKING_OPEN") {
      socket.emit("host:error", { message: "Editing not allowed now" });
      return;
    }
    const ticket = gameState.tickets.find((t) => t.id === ticketId);
    if (ticket && ticket.isBooked && !ticket.isFullHousieWinner) {
      ticket.bookedBy = newPlayerName;
      broadcastState();
    }
  });

  socket.on("host:unbookTicket", ({ ticketId }) => {
    if (!requireHost()) return;
    if (gameState.status !== "BOOKING_OPEN") {
      socket.emit("host:error", { message: "Unbooking not allowed now" });
      return;
    }
    const ticket = gameState.tickets.find((t) => t.id === ticketId);
    if (ticket && ticket.isBooked && !ticket.isFullHousieWinner) {
      ticket.isBooked = false;
      ticket.bookedBy = null;
      broadcastState();
    }
  });

  socket.on("player:requestBooking", ({ ticketId, playerName }) => {
    if (gameState.status !== "BOOKING_OPEN") {
      socket.emit("host:error", { message: "Bookings are closed" });
      return;
    }
    const ticket = gameState.tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      socket.emit("host:error", { message: "Ticket not found" });
      return;
    }
    if (ticket.isBooked || ticket.isFullHousieWinner) {
      socket.emit("host:error", { message: "Ticket already booked or won" });
      return;
    }
    if (ticket.isPending) {
      socket.emit("host:error", { message: "Ticket already pending" });
      return;
    }
    ticket.isPending = true;
    ticket.pendingPlayerName = playerName;
    broadcastState();
  });

  socket.on("host:confirmPending", ({ ticketId }) => {
    if (!requireHost()) return;
    const ticket = gameState.tickets.find((t) => t.id === ticketId);
    if (!ticket || !ticket.isPending) {
      socket.emit("host:error", {
        message: "No pending booking for this ticket",
      });
      return;
    }
    ticket.isBooked = true;
    ticket.bookedBy = ticket.pendingPlayerName;
    ticket.isPending = false;
    ticket.pendingPlayerName = null;
    broadcastState();
  });

  socket.on("host:cancelPending", ({ ticketId }) => {
    if (!requireHost()) return;
    const ticket = gameState.tickets.find((t) => t.id === ticketId);
    if (!ticket || !ticket.isPending) {
      socket.emit("host:error", {
        message: "No pending booking for this ticket",
      });
      return;
    }
    ticket.isPending = false;
    ticket.pendingPlayerName = null;
    broadcastState();
  });

  socket.on("disconnect", () => {
    console.log("user disconnected");
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
