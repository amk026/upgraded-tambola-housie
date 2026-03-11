// ---------- GLOBAL VARIABLES ----------
const socket = io();
let gameState = {
  tickets: [],
  calledNumbers: [],
  fullHousieWinners: [],
  winners: [],
  status: "NO_ACTIVE_GAME",
  drawSequence: [],
  drawIndex: 0,
  gameCreatedAt: null,
  gameStartedAt: null,
  gameEndedAt: null,
  countdownEndTime: null,
  lastCallTime: null,
  maxWinners: 5,
  currentPrizeRank: 1,
  gameEndReason: null,
  gameName: "",
  visibleToPlayers: false,
  prizeCategories: [],
  scheduledStartTime: null,
  countdownPaused: false,
  whatsappConfig: [],
  customDrawSequence: null,
  allowMultipleWinsPerTicket: false,
  allowMultipleWinnersPerPrize: true,
};
let isHostAuthenticated = false;
let hostSearchTerm = "";
let playerSearchTerm = "";
let hostFilter = "all";
let countdownInterval = null;

// Inline form state
let activeBookingTicketId = null;
let activeEditTicketId = null;

// Wizard state
let wizardStep = 1;
let wizardConfig = {
  gameName: "",
  visibleToPlayers: true,
  ticketCount: 50,
  prizeCategories: [],
};

// Text-to-Speech
let lastSpokenCountdownSecond = -1;
let currentUtterance = null;

// Current active tab
let currentTab = "draworder";

// Player selected tickets for multi‑booking
let selectedTickets = [];

// Host selected tickets for batch operations
let hostSelectedUnbooked = []; // IDs of unbooked tickets selected
let hostSelectedPending = []; // IDs of pending tickets selected

// Game over overlay timer
let gameOverTimer = null;

// Collapsible states
let hostInfoCollapsed = false;
let playerInfoCollapsed = false;
let whatsappCollapsed = false;
let tabContentCollapsed = false; // New: tracks if tab content is collapsed

// Flag to differentiate between set and clear for custom draw order
let clearingDrawOrder = false;

// ---------- Pattern Checkers (updated with Early Seven) ----------
function checkEarlyFive(ticketNumbers, calledNumbers) {
  const flat = ticketNumbers.flat().filter((n) => n !== 0);
  const markedCount = flat.filter((n) => calledNumbers.includes(n)).length;
  return markedCount >= 5;
}

function checkEarlySeven(ticketNumbers, calledNumbers) {
  const flat = ticketNumbers.flat().filter((n) => n !== 0);
  const markedCount = flat.filter((n) => calledNumbers.includes(n)).length;
  return markedCount >= 7;
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
  "Early Seven": checkEarlySeven,
  "Top Line": checkTopLine,
  "Middle Line": checkMiddleLine,
  "Bottom Line": checkBottomLine,
  "Full House": checkFullHouse,
  Corners: checkCorners,
};

// ---------- Custom Modal Functions (unchanged) ----------
function showAlert(message) {
  return new Promise((resolve) => {
    document.getElementById("alertMessage").textContent = message;
    const modal = document.getElementById("alertModal");
    modal.classList.add("show");
    const closeHandler = () => {
      modal.classList.remove("show");
      document
        .getElementById("alertOkBtn")
        .removeEventListener("click", closeHandler);
      resolve();
    };
    document
      .getElementById("alertOkBtn")
      .addEventListener("click", closeHandler);
  });
}

function showConfirm(message) {
  return new Promise((resolve) => {
    document.getElementById("confirmMessage").textContent = message;
    const modal = document.getElementById("confirmModal");
    modal.classList.add("show");
    const yesHandler = () => {
      modal.classList.remove("show");
      document
        .getElementById("confirmYesBtn")
        .removeEventListener("click", yesHandler);
      document
        .getElementById("confirmNoBtn")
        .removeEventListener("click", noHandler);
      resolve(true);
    };
    const noHandler = () => {
      modal.classList.remove("show");
      document
        .getElementById("confirmYesBtn")
        .removeEventListener("click", yesHandler);
      document
        .getElementById("confirmNoBtn")
        .removeEventListener("click", noHandler);
      resolve(false);
    };
    document
      .getElementById("confirmYesBtn")
      .addEventListener("click", yesHandler);
    document
      .getElementById("confirmNoBtn")
      .addEventListener("click", noHandler);
  });
}

function showPrompt(message, defaultValue = "") {
  return new Promise((resolve) => {
    document.getElementById("promptMessage").textContent = message;
    document.getElementById("promptInput").value = defaultValue;
    const modal = document.getElementById("promptModal");
    modal.classList.add("show");
    const okHandler = () => {
      const val = document.getElementById("promptInput").value;
      modal.classList.remove("show");
      document
        .getElementById("promptOkBtn")
        .removeEventListener("click", okHandler);
      document
        .getElementById("promptCancelBtn")
        .removeEventListener("click", cancelHandler);
      resolve(val);
    };
    const cancelHandler = () => {
      modal.classList.remove("show");
      document
        .getElementById("promptOkBtn")
        .removeEventListener("click", okHandler);
      document
        .getElementById("promptCancelBtn")
        .removeEventListener("click", cancelHandler);
      resolve(null);
    };
    document.getElementById("promptOkBtn").addEventListener("click", okHandler);
    document
      .getElementById("promptCancelBtn")
      .addEventListener("click", cancelHandler);
  });
}

// Replace native alerts
window.alert = async function (msg) {
  await showAlert(msg);
};
window.confirm = async function (msg) {
  return await showConfirm(msg);
};
window.prompt = async function (msg, def) {
  return await showPrompt(msg, def);
};

// ---------- Helper: Get WhatsApp number for a ticket ----------
function getWhatsAppNumberForTicket(ticketId) {
  const match = ticketId.match(/T-(\d+)/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const config = gameState.whatsappConfig || [];
  console.log(
    "🔍 Checking ticket",
    ticketId,
    "number",
    num,
    "against config:",
    config,
  );
  for (const range of config) {
    if (num >= range.start && num <= range.end) {
      const cleanNumber = range.number.replace(/\D/g, "");
      console.log(
        "✅ Found matching range:",
        range,
        "cleaned number:",
        cleanNumber,
      );
      return cleanNumber;
    }
  }
  console.log("❌ No matching range for ticket", ticketId);
  return null;
}

// ---------- Helper: Format scheduled time ----------
function formatScheduledTime(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------- LIGHT/DARK MODE TOGGLE ----------
function toggleTheme() {
  document.body.classList.toggle("light-mode");
  const isLight = document.body.classList.contains("light-mode");
  localStorage.setItem("theme", isLight ? "light" : "dark");
  updateThemeIcons();
}

function updateThemeIcons() {
  const isLight = document.body.classList.contains("light-mode");
  const icons = document.querySelectorAll(".theme-toggle");
  icons.forEach((icon) => {
    icon.textContent = isLight ? "🌙" : "☀️";
  });
}

function loadTheme() {
  const saved = localStorage.getItem("theme");
  if (saved === "light") {
    document.body.classList.add("light-mode");
  }
  updateThemeIcons();
}

// ---------- SOCKET HANDLERS ----------
function attemptHostLogin() {
  if (localStorage.getItem("hostAuth") === "true") {
    const username = localStorage.getItem("hostUser") || "admin";
    const password = localStorage.getItem("hostPass") || "myNewSecret";
    socket.emit("host:login", { username, password });
  }
}

socket.on("connect", attemptHostLogin);

// If already connected, try to login now
if (socket.connected) {
  attemptHostLogin();
}

socket.on("gameState", (newState) => {
  console.log(
    "📥 Received gameState, whatsappConfig:",
    newState.whatsappConfig,
  );
  const oldCalledLength = gameState.calledNumbers?.length || 0;
  gameState = { ...gameState, ...newState };

  if (gameState.calledNumbers.length > oldCalledLength) {
    const newNum = gameState.calledNumbers[gameState.calledNumbers.length - 1];
    if (!isHostAuthenticated) {
      showPopupNumber(newNum);
      speak(newNum.toString());
    } else {
      speak(newNum.toString());
    }
    updateStickyNumber(newNum);
  }

  updateUI();
  handleCountdownTimer();
  toggleWinnersVisibility();
  showGameOverOverlay();
});

socket.on("newWinner", (winner) => {
  confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
});

socket.on("host:login:success", () => {
  console.log("Login success");
  isHostAuthenticated = true;
  localStorage.setItem("hostAuth", "true");
  localStorage.setItem("hostUser", document.getElementById("username").value);
  localStorage.setItem("hostPass", document.getElementById("password").value);
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  document.getElementById("loginError").style.display = "none";
  updateUI();
});

socket.on("host:login:failure", (data) => {
  document.getElementById("loginError").textContent =
    data.message || "Invalid credentials";
  document.getElementById("loginError").style.display = "block";
  localStorage.removeItem("hostAuth");
  localStorage.removeItem("hostUser");
  localStorage.removeItem("hostPass");
});

socket.on("host:error", async (data) => {
  await showAlert(data.message || "An error occurred");
});

socket.on("host:customDrawOrderSet", () => {
  // Differentiate between set and clear
  if (clearingDrawOrder) {
    showAlert("Custom draw order cleared successfully.");
    clearingDrawOrder = false;
  } else {
    showAlert("Custom draw order set successfully.");
  }
});

socket.on("host:settingsUpdated", () => {
  console.log("Settings updated");
});

socket.on("host:ticketDeleted", ({ ticketId }) => {
  console.log(`Ticket ${ticketId} deleted`);
});

socket.on("host:ticketsDeleted", (data) => {
  console.log("Tickets deleted:", data);
});

socket.on("host:pendingCancelled", (data) => {
  console.log("Pending cancelled:", data);
});

socket.on("disconnect", () => {
  console.log("Socket disconnected");
});

// ---------- UI UPDATE FUNCTIONS ----------
function updateUI() {
  const isHostPage = window.location.pathname === "/host";
  if (isHostPage) {
    document.getElementById("hostView").style.display = "block";
    document.getElementById("playerView").style.display = "none";
    if (isHostAuthenticated) {
      renderHost();
    }
  } else {
    document.getElementById("hostView").style.display = "none";
    document.getElementById("playerView").style.display = "block";
    renderPlayer();
  }
  updateStatusBadges();
}

function renderHost() {
  const total = gameState.tickets.length;
  const booked = gameState.tickets.filter((t) => t.isBooked).length;
  const pending = gameState.tickets.filter((t) => t.isPending).length;
  const available = total - booked - pending;
  const prizeRanksAwarded = gameState.winners.length;

  document.getElementById("totalTickets").textContent = total;
  document.getElementById("bookedTickets").textContent = booked;
  document.getElementById("availableTickets").textContent = available;
  document.getElementById("winnersCount").textContent =
    `${prizeRanksAwarded}/${gameState.prizeCategories.reduce((acc, cat) => acc + cat.prizes.length, 0)}`;

  const searchInput = document.getElementById("hostSearchInput");
  searchInput.style.display = "block";

  renderHostFilters(total, booked, pending, available);

  renderWinners("host");
  renderTickets("host");
  renderHostGameInfo();
  renderScheduledTime("host");

  // Always show WhatsApp config
  renderWhatsAppConfig();

  if (gameState.status !== "NO_ACTIVE_GAME") {
    document.getElementById("hostNavBar").style.display = "flex";
    // Apply collapsed state to tab content
    document.getElementById("tabContent").style.display = tabContentCollapsed
      ? "none"
      : "block";
    renderCustomDrawOrder();
    updateGameControlVisibility();
  } else {
    document.getElementById("hostNavBar").style.display = "none";
    document.getElementById("tabContent").style.display = "none";
  }

  renderScheduledTime("host");

  if (gameState.status === "NO_ACTIVE_GAME") {
    document.getElementById("createGameWizard").style.display = "block";
    document.getElementById("gameControls").style.display = "none";
    document.getElementById("schedulingPanel").style.display = "none";
    renderWizard();
  } else {
    document.getElementById("createGameWizard").style.display = "none";
  }

  // Batch actions: show only relevant buttons
  const batchActions = document.getElementById("hostBatchActions");
  if (gameState.status === "BOOKING_OPEN") {
    batchActions.style.display = "flex";

    // Delete selected unbooked button
    const deleteBtn = document.getElementById("deleteSelectedUnbookedBtn");
    if (hostFilter === "available" && hostSelectedUnbooked.length > 0) {
      deleteBtn.style.display = "inline-block";
      deleteBtn.textContent = `🗑️ Delete Selected (${hostSelectedUnbooked.length})`;
    } else {
      deleteBtn.style.display = "none";
    }

    // Cancel selected pending button
    const cancelBtn = document.getElementById("cancelSelectedPendingBtn");
    if (hostFilter === "pending" && hostSelectedPending.length > 0) {
      cancelBtn.style.display = "inline-block";
      cancelBtn.textContent = `❌ Cancel Selected (${hostSelectedPending.length})`;
    } else {
      cancelBtn.style.display = "none";
    }

    // Select All button: show only if at least one ticket is selected
    const selectAllBtn = document.getElementById("selectAllBtn");
    if (
      (hostFilter === "available" && hostSelectedUnbooked.length > 0) ||
      (hostFilter === "pending" && hostSelectedPending.length > 0)
    ) {
      selectAllBtn.style.display = "inline-block";
      // Determine if all visible are selected
      let allSelected = false;
      if (hostFilter === "available") {
        const visible = gameState.tickets.filter(
          (t) => !t.isBooked && !t.isPending && !t.isFullHousieWinner,
        );
        allSelected = visible.every((t) => hostSelectedUnbooked.includes(t.id));
      } else if (hostFilter === "pending") {
        const visible = gameState.tickets.filter(
          (t) => t.isPending && !t.isFullHousieWinner,
        );
        allSelected = visible.every((t) => hostSelectedPending.includes(t.id));
      }
      selectAllBtn.textContent = allSelected ? "Deselect All" : "Select All";
    } else {
      selectAllBtn.style.display = "none";
    }
  } else {
    batchActions.style.display = "none";
  }

  if (gameState.status === "COUNTDOWN") {
    document.getElementById("pauseCountdownBtn").style.display =
      gameState.countdownPaused ? "none" : "inline-block";
    document.getElementById("resumeCountdownBtn").style.display =
      gameState.countdownPaused ? "inline-block" : "none";
  } else {
    document.getElementById("pauseCountdownBtn").style.display = "none";
    document.getElementById("resumeCountdownBtn").style.display = "none";
  }

  const countdownCard = document.getElementById("hostCountdownCard");
  if (gameState.status === "COUNTDOWN" && gameState.countdownEndTime) {
    countdownCard.style.display = "block";
  } else {
    countdownCard.style.display = "none";
  }

  document.getElementById("hostCurrentNumberSticky").style.display = "none";

  if (gameState.status !== "BOOKING_OPEN") {
    document.getElementById("inlineCountdown").style.display = "none";
  }
}

function updateGameControlVisibility() {
  const gameControls = document.getElementById("gameControls");
  const schedulingPanel = document.getElementById("schedulingPanel");

  if (gameState.status === "BOOKING_OPEN" && !gameState.scheduledStartTime) {
    schedulingPanel.style.display = "block";
  } else {
    schedulingPanel.style.display = "none";
  }

  gameControls.style.display = "block";
}

function renderGameSettings() {
  const container = document.getElementById("gameSettingsContainer");
  if (!container) return;

  let html = `
    <div class="settings-section glass-card" style="margin-bottom:1.5rem;">
      <h4>⚙️ Game Settings</h4>
      <div class="setting-item">
        <label>
          <input type="checkbox" id="allowMultipleWinsCheck" ${gameState.allowMultipleWinsPerTicket ? "checked" : ""}>
          Allow a ticket to win multiple prizes (different patterns)
        </label>
        <p class="setting-hint">If enabled, a ticket can win e.g. Early Five and Full House.</p>
      </div>
      <div class="setting-item">
        <label>
          <input type="checkbox" id="allowMultipleWinnersPerPrizeCheck" ${gameState.allowMultipleWinnersPerPrize ? "checked" : ""}>
          Allow multiple tickets to win the same prize (if they complete pattern simultaneously)
        </label>
        <p class="setting-hint">If disabled, only one ticket wins when multiple hit at once.</p>
      </div>
      <button id="saveSettingsBtn" class="btn primary small">Save Settings</button>
    </div>
  `;
  container.innerHTML = html;

  document.getElementById("saveSettingsBtn").addEventListener("click", () => {
    const multiTicket = document.getElementById(
      "allowMultipleWinsCheck",
    ).checked;
    const multiWinner = document.getElementById(
      "allowMultipleWinnersPerPrizeCheck",
    ).checked;
    socket.emit("host:updateSettings", {
      allowMultipleWinsPerTicket: multiTicket,
      allowMultipleWinnersPerPrize: multiWinner,
    });
    showAlert("Settings saved.");
  });
}

function renderHostFilters(total, booked, pending, available) {
  const container = document.getElementById("hostFilterButtons");
  if (!container) return;
  const filters = [
    { key: "all", label: `All (${total})` },
    { key: "available", label: `Available (${available})` },
    { key: "booked", label: `Booked (${booked})` },
    { key: "pending", label: `Pending (${pending})` },
  ];
  let html = '<div class="filter-buttons">';
  filters.forEach((f) => {
    const activeClass = hostFilter === f.key ? "active" : "";
    html += `<button class="filter-btn ${activeClass}" data-filter="${f.key}">${f.label}</button>`;
  });
  html += "</div>";
  container.innerHTML = html;

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      hostFilter = e.target.dataset.filter;
      // Clear selections when switching filter
      hostSelectedUnbooked = [];
      hostSelectedPending = [];
      renderHost();
    });
  });
}

function renderScheduledTime(view) {
  const containerId =
    view === "host" ? "hostScheduledTime" : "playerScheduledTime";
  const container = document.getElementById(containerId);
  if (!container) return;

  if (gameState.scheduledStartTime && gameState.status === "BOOKING_OPEN") {
    const formatted = formatScheduledTime(gameState.scheduledStartTime);
    container.innerHTML = `
      <div class="scheduled-time-card glass-card">
        <span class="icon">⏰</span>
        <div class="scheduled-info">
          <div class="scheduled-label">Game starts at:</div>
          <div class="scheduled-value">${formatted}</div>
        </div>
      </div>
    `;
    container.style.display = "block";
  } else {
    container.style.display = "none";
  }
}

async function openBookedListModal() {
  const modal = document.getElementById("bookedListModal");
  const tbody = document.getElementById("bookedListBody");
  if (!tbody) return;

  const bookedTickets = gameState.tickets.filter(
    (t) => (t.isBooked || t.isPending) && !t.isFullHousieWinner,
  );
  let html = "";
  bookedTickets.forEach((t) => {
    const status = t.isBooked ? "Booked" : "Pending";
    html += `<tr><td>${t.id}</td><td>${t.bookedBy || t.pendingPlayerName || "—"}</td><td>${status}</td></tr>`;
  });
  tbody.innerHTML = html;
  modal.classList.add("show");
}

function printBookedList() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("Booked Tickets List", 105, 15, { align: "center" });

  const bookedTickets = gameState.tickets.filter(
    (t) => (t.isBooked || t.isPending) && !t.isFullHousieWinner,
  );

  const headers = [["Ticket ID", "Player Name", "Status"]];
  const data = bookedTickets.map((t) => [
    t.id,
    t.bookedBy || t.pendingPlayerName || "—",
    t.isBooked ? "Booked" : "Pending",
  ]);

  doc.autoTable({
    head: headers,
    body: data,
    startY: 25,
    theme: "grid",
    headStyles: {
      fillColor: [99, 102, 241],
      textColor: 255,
      fontStyle: "bold",
    },
    styles: {
      cellPadding: 3,
      fontSize: 10,
      lineColor: [80, 80, 80],
      lineWidth: 0.2,
    },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: "auto" },
      2: { cellWidth: 30 },
    },
  });

  const pdfBlob = doc.output("blob");
  const pdfUrl = URL.createObjectURL(pdfBlob);
  window.open(pdfUrl);
}

function printWinnersPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("Winners List", 105, 15, { align: "center" });

  const winners = gameState.winners || [];
  const headers = [["Pattern", "Prize", "Player", "Ticket"]];
  const data = winners.map((w) => [
    w.pattern,
    w.prizeTitle,
    w.playerName || "—",
    w.ticketId,
  ]);

  doc.autoTable({
    head: headers,
    body: data,
    startY: 25,
    theme: "grid",
    headStyles: {
      fillColor: [99, 102, 241],
      textColor: 255,
      fontStyle: "bold",
    },
    styles: {
      cellPadding: 3,
      fontSize: 9,
      lineColor: [80, 80, 80],
      lineWidth: 0.2,
    },
  });

  const pdfBlob = doc.output("blob");
  const pdfUrl = URL.createObjectURL(pdfBlob);
  window.open(pdfUrl);
}

function renderCustomDrawOrder() {
  const container = document.getElementById("customDrawOrderContainer");
  if (!container) return;

  const settingsHtml = `
    <div id="gameSettingsContainer"></div>
  `;
  let html = settingsHtml;

  html += `
    <div class="custom-draw-section glass-card" style="margin-bottom:1.5rem;">
      <h3>🎲 Custom Draw Order</h3>
      <p>Enter the sequence of numbers 1–90 (comma separated) that will be called.</p>
      <textarea id="customDrawInput" class="input" placeholder="e.g. 1,2,3,4,...90" rows="3">${gameState.customDrawSequence ? gameState.customDrawSequence.join(", ") : ""}</textarea>
      <div class="button-group" style="margin-top:0.5rem;">
        <button id="setCustomDrawBtn" class="btn primary">Set Order</button>
        <button id="clearCustomDrawBtn" class="btn secondary">Clear</button>
        <button id="simulateDrawBtn" class="btn success">🎲 Simulate</button>
      </div>
      <div id="customDrawStatus" class="status-message"></div>
    </div>
  `;
  container.innerHTML = html;

  renderGameSettings();

  document.getElementById("setCustomDrawBtn").addEventListener("click", () => {
    const input = document.getElementById("customDrawInput").value.trim();
    if (!input) {
      document.getElementById("customDrawStatus").textContent =
        "Please enter a sequence.";
      return;
    }
    const parts = input.split(",").map((s) => s.trim());
    const numbers = parts.map((p) => parseInt(p, 10)).filter((n) => !isNaN(n));
    if (numbers.length !== 90) {
      document.getElementById("customDrawStatus").textContent =
        "Must be exactly 90 numbers.";
      return;
    }
    const unique = new Set(numbers);
    if (unique.size !== 90) {
      document.getElementById("customDrawStatus").textContent =
        "All numbers must be unique.";
      return;
    }
    const allInRange = numbers.every((n) => n >= 1 && n <= 90);
    if (!allInRange) {
      document.getElementById("customDrawStatus").textContent =
        "Numbers must be between 1 and 90.";
      return;
    }
    // Ensure clear flag is off before emitting set
    clearingDrawOrder = false;
    socket.emit("host:setCustomDrawOrder", { sequence: numbers });
    document.getElementById("customDrawStatus").textContent =
      "✅ Custom order set.";
  });

  document
    .getElementById("clearCustomDrawBtn")
    .addEventListener("click", async () => {
      document.getElementById("customDrawInput").value = "";
      // Set flag so we know this was a clear operation
      clearingDrawOrder = true;
      socket.emit("host:setCustomDrawOrder", { sequence: [] });
      document.getElementById("customDrawStatus").textContent =
        "✅ Custom order cleared.";
      // Also show alert immediately? The socket response will trigger the alert,
      // but we want it to say "cleared". The flag ensures that.
    });

  document
    .getElementById("simulateDrawBtn")
    .addEventListener("click", simulateGame);
}

// ---------- SIMULATION FUNCTION ----------
function simulateGame() {
  const input = document.getElementById("customDrawInput").value.trim();
  let drawSequence;
  if (input) {
    const parts = input.split(",").map((s) => s.trim());
    const numbers = parts.map((p) => parseInt(p, 10)).filter((n) => !isNaN(n));
    if (
      numbers.length !== 90 ||
      new Set(numbers).size !== 90 ||
      !numbers.every((n) => n >= 1 && n <= 90)
    ) {
      showAlert(
        "Invalid custom draw order. Please enter a valid sequence or leave empty for random.",
      );
      return;
    }
    drawSequence = numbers;
  } else {
    const nums = Array.from({ length: 90 }, (_, i) => i + 1);
    for (let i = nums.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    drawSequence = nums;
    document.getElementById("customDrawInput").value = nums.join(", ");
  }

  const simTickets = gameState.tickets.map((t) => ({ ...t }));
  const simWinners = [];
  const prizeCategories = JSON.parse(JSON.stringify(gameState.prizeCategories));

  prizeCategories.forEach((cat) =>
    cat.prizes.forEach((p) => (p.awarded = false)),
  );

  const calledNumbers = [];
  const allowMultipleWinsPerTicket = gameState.allowMultipleWinsPerTicket;
  const allowMultipleWinnersPerPrize = gameState.allowMultipleWinnersPerPrize;

  const results = [];

  for (let idx = 0; idx < drawSequence.length; idx++) {
    const number = drawSequence[idx];
    calledNumbers.push(number);

    for (const category of prizeCategories) {
      const pattern = category.name;
      const checker = patternCheckers[pattern];
      if (!checker) continue;

      let eligibleTickets = simTickets;

      if (!allowMultipleWinsPerTicket) {
        eligibleTickets = eligibleTickets.filter(
          (t) => !simWinners.some((w) => w.ticketId === t.id),
        );
      } else {
        eligibleTickets = eligibleTickets.filter(
          (t) =>
            !simWinners.some(
              (w) => w.ticketId === t.id && w.pattern === pattern,
            ),
        );
      }

      const newlyCompleted = eligibleTickets.filter((t) =>
        checker(t.numbers, calledNumbers),
      );

      if (newlyCompleted.length === 0) continue;

      const prize = category.prizes.find((p) => !p.awarded);
      if (!prize) continue;

      if (allowMultipleWinnersPerPrize) {
        newlyCompleted.forEach((ticket) => {
          simWinners.push({
            pattern,
            prizeTitle: prize.title,
            prizeAmount: prize.amount,
            ticketId: ticket.id,
            playerName: ticket.bookedBy,
            callNumber: number,
            callIndex: idx + 1,
          });
        });
        prize.awarded = true;
        results.push({
          pattern,
          prizeTitle: prize.title,
          prizeAmount: prize.amount,
          winners: newlyCompleted.map((t) => ({
            ticketId: t.id,
            playerName: t.bookedBy,
            callNumber: number,
            callIndex: idx + 1,
          })),
        });
      } else {
        const winnerTicket = newlyCompleted[0];
        simWinners.push({
          pattern,
          prizeTitle: prize.title,
          prizeAmount: prize.amount,
          ticketId: winnerTicket.id,
          playerName: winnerTicket.bookedBy,
          callNumber: number,
          callIndex: idx + 1,
        });
        prize.awarded = true;
        results.push({
          pattern,
          prizeTitle: prize.title,
          prizeAmount: prize.amount,
          winners: [
            {
              ticketId: winnerTicket.id,
              playerName: winnerTicket.bookedBy,
              callNumber: number,
              callIndex: idx + 1,
            },
          ],
        });
      }
    }

    const allAwarded = prizeCategories.every((cat) =>
      cat.prizes.every((p) => p.awarded),
    );
    if (allAwarded) break;
  }

  showSimulationResults(results, drawSequence);
}

function showSimulationResults(results, drawSequence) {
  const modal = document.getElementById("simulationModal");
  const tbody = document.getElementById("simulationResultsBody");
  let html = "";
  results.forEach((r) => {
    r.winners.forEach((w) => {
      html += `<tr>
        <td>${r.pattern}</td>
        <td>${r.prizeTitle}</td>
        <td>₹${r.prizeAmount}</td>
        <td>${w.ticketId}</td>
        <td>${w.playerName || "—"}</td>
        <td>${w.callNumber} (${w.callIndex})</td>
      </tr>`;
    });
  });
  if (html === "") {
    html =
      '<tr><td colspan="6" style="text-align:center">No winners in this simulation</td></tr>';
  }
  tbody.innerHTML = html;
  modal.classList.add("show");
}

// WhatsApp configuration
function renderWhatsAppConfig() {
  const container = document.getElementById("whatsappConfigContainer");
  if (!container) return;

  let html = `
    <div class="collapsible-header" onclick="toggleWhatsappCollapse()">
      <h3>📱 WhatsApp Numbers</h3>
      <span class="collapse-icon">${whatsappCollapsed ? "▶" : "▼"}</span>
    </div>
    <div id="whatsappContent" class="collapsible-content ${whatsappCollapsed ? "collapsed" : ""}">
      <p>Assign WhatsApp numbers to ticket ranges (e.g., 1->50, 51->100). Mark one as primary for multi‑ticket bookings. Ranges must be between 1 and 1000.</p>
      <div id="whatsappRangesList"></div>
      <div class="whatsapp-add-range">
        <input type="number" id="newRangeStart" class="input" placeholder="Start" min="1" max="1000">
        <input type="number" id="newRangeEnd" class="input" placeholder="End" min="1" max="1000">
        <input type="text" id="newRangeNumber" class="input" placeholder="WhatsApp number (with country code)">
        <button id="addWhatsAppRangeBtn" class="btn success">Add Range</button>
      </div>
      <button id="saveWhatsAppConfigBtn" class="btn primary">Save Configuration</button>
    </div>
  `;
  container.innerHTML = html;

  const rangesList = document.getElementById("whatsappRangesList");
  function renderRanges() {
    let listHtml = "";
    (gameState.whatsappConfig || []).forEach((range, index) => {
      listHtml += `
        <div class="whatsapp-range-item">
          <span>${range.start} -> ${range.end} => [${range.number}]</span>
          <label>
            <input type="radio" name="primaryWhatsApp" data-index="${index}" ${range.primary ? "checked" : ""}> Primary 
          </label>
          <button class="btn danger small" onclick="removeWhatsAppRange(${index})">✖</button>
        </div>
      `;
    });
    rangesList.innerHTML = listHtml || "<p>No ranges configured.</p>";

    document
      .querySelectorAll('input[name="primaryWhatsApp"]')
      .forEach((radio) => {
        radio.addEventListener("change", (e) => {
          const idx = parseInt(e.target.dataset.index, 10);
          gameState.whatsappConfig.forEach((r, i) => {
            r.primary = i === idx;
          });
          renderRanges();
        });
      });
  }
  renderRanges();

  window.removeWhatsAppRange = (index) => {
    const newConfig = [...(gameState.whatsappConfig || [])];
    newConfig.splice(index, 1);
    gameState.whatsappConfig = newConfig;
    renderRanges();
  };

  document
    .getElementById("addWhatsAppRangeBtn")
    .addEventListener("click", () => {
      const start = parseInt(
        document.getElementById("newRangeStart").value,
        10,
      );
      const end = parseInt(document.getElementById("newRangeEnd").value, 10);
      const number = document.getElementById("newRangeNumber").value.trim();
      if (!start || !end || !number) {
        showAlert("Please fill all fields.");
        return;
      }
      if (start < 1 || start > 1000 || end < 1 || end > 1000) {
        showAlert("Start and end must be between 1 and 1000.");
        return;
      }
      if (start > end) {
        showAlert("Start must be less than or equal to end.");
        return;
      }
      const newConfig = [...(gameState.whatsappConfig || [])];
      newConfig.push({ start, end, number, primary: false });
      gameState.whatsappConfig = newConfig;
      renderRanges();
      document.getElementById("newRangeStart").value = "";
      document.getElementById("newRangeEnd").value = "";
      document.getElementById("newRangeNumber").value = "";
    });

  container.addEventListener("click", (e) => {
    if (e.target.id === "saveWhatsAppConfigBtn") {
      console.log("💾 Saving WhatsApp config:", gameState.whatsappConfig);
      socket.emit("host:updateWhatsappConfig", {
        config: gameState.whatsappConfig,
      });
      showAlert("WhatsApp configuration saved.");
    }
  });
}

function toggleWhatsappCollapse() {
  whatsappCollapsed = !whatsappCollapsed;
  renderWhatsAppConfig();
}

function renderPlayer() {
  const stats = document.getElementById("playerStats");
  const calledWrapper = document.getElementById("playerCalledWrapper");
  const winnersSection = document.getElementById("playerWinnersSection");
  const searchWrapper = document.getElementById("playerSearchWrapper");
  const ticketsGrid = document.getElementById("playerTicketsGrid");
  const noResults = document.getElementById("playerNoResults");
  const countdownCard = document.getElementById("playerCountdownCard");
  const sticky = document.getElementById("playerCurrentNumberSticky");
  const prizeInfo = document.getElementById("playerPrizeInfo");

  const total = gameState.tickets.length;
  const booked = gameState.tickets.filter((t) => t.isBooked).length;
  const pending = gameState.tickets.filter((t) => t.isPending).length;
  const available = total - booked - pending;
  const prizeRanksAwarded = gameState.winners.length;

  const availElem = document.getElementById("playerAvailableTickets");
  const winnersElem = document.getElementById("playerWinnersCount");

  if (availElem) availElem.textContent = available;
  if (winnersElem)
    winnersElem.textContent = `${prizeRanksAwarded}/${gameState.prizeCategories.reduce((acc, cat) => acc + cat.prizes.length, 0)}`;

  if (gameState.status === "RUNNING") {
    stats.style.display = "none";
  } else {
    stats.style.display = "grid";
  }

  if (calledWrapper) {
    calledWrapper.style.display =
      gameState.status === "COUNTDOWN" ||
      gameState.status === "RUNNING" ||
      gameState.status === "COMPLETED"
        ? "block"
        : "none";
  }

  renderCalledNumbers("player");
  renderWinners("player");
  renderPlayerPrizeInfo();
  renderScheduledTime("player");

  const compactGridContainer = document.getElementById(
    "playerTicketGridContainer",
  );
  if (compactGridContainer) {
    compactGridContainer.style.display = "none";
  }
  const viewAvailableBtn = document.getElementById("viewAvailableBtn");
  if (viewAvailableBtn) {
    viewAvailableBtn.style.display =
      gameState.status === "BOOKING_OPEN" && gameState.visibleToPlayers
        ? "block"
        : "none";
  }

  if (gameState.status === "COUNTDOWN" && gameState.countdownEndTime) {
    countdownCard.style.display = "block";
  } else {
    countdownCard.style.display = "none";
  }

  if (gameState.status === "RUNNING" && gameState.calledNumbers.length > 0) {
    sticky.style.display = "block";
    document.getElementById("playerCurrentNumberValue").textContent =
      gameState.calledNumbers[gameState.calledNumbers.length - 1];
  } else {
    sticky.style.display = "none";
  }

  renderTickets("player");
}

// ---------- Compact Grid Functions ----------
function renderCompactGridContent() {
  const container = document.getElementById("playerCompactGridContainer");
  if (!container) return;
  let html = '<div class="player-ticket-grid">';
  gameState.tickets.forEach((t) => {
    const numPart = t.id.split("-")[1];
    let statusClass = "available";
    if (t.isBooked) statusClass = "booked";
    else if (t.isPending) statusClass = "pending";
    if (selectedTickets.includes(t.id)) statusClass += " selected";
    html += `<div class="grid-cell ${statusClass}" data-ticket-id="${t.id}" title="${t.id} - ${t.bookedBy || t.pendingPlayerName || ""}">${numPart}</div>`;
  });
  html += "</div>";
  container.innerHTML = html;

  container.querySelectorAll(".grid-cell").forEach((cell) => {
    cell.addEventListener("click", (e) => {
      const tid = e.target.dataset.ticketId;
      const ticket = gameState.tickets.find((t) => t.id === tid);
      if (
        ticket &&
        !ticket.isBooked &&
        !ticket.isPending &&
        !ticket.isFullHousieWinner
      ) {
        toggleTicketSelection(tid);
        e.target.classList.toggle("selected", selectedTickets.includes(tid));
        document.getElementById("selectedCount").textContent =
          selectedTickets.length;
      }
    });
  });
}

function showPlayerCompactGrid() {
  const modal = document.getElementById("playerCompactGridModal");
  renderCompactGridContent();
  document.getElementById("selectedCount").textContent = selectedTickets.length;
  modal.classList.add("show");
}

function toggleTicketSelection(ticketId) {
  const index = selectedTickets.indexOf(ticketId);
  if (index === -1) {
    selectedTickets.push(ticketId);
  } else {
    selectedTickets.splice(index, 1);
  }
  document.getElementById("selectedCount").textContent = selectedTickets.length;
}

function clearTicketSelection() {
  selectedTickets = [];
  const modal = document.getElementById("playerCompactGridModal");
  if (modal.classList.contains("show")) {
    renderCompactGridContent();
  }
  document.getElementById("selectedCount").textContent = 0;
}

async function bookSelectedTickets() {
  document.getElementById("playerCompactGridModal").classList.remove("show");

  if (selectedTickets.length === 0) {
    await showAlert("No tickets selected.");
    return;
  }
  const playerName = await showPrompt("Enter your name to book these tickets:");
  if (!playerName || playerName.trim() === "") return;

  selectedTickets.forEach((tid) => {
    socket.emit("player:requestBooking", {
      ticketId: tid,
      playerName: playerName.trim(),
    });
  });

  const numbers = selectedTickets
    .map((tid) => getWhatsAppNumberForTicket(tid))
    .filter(Boolean);
  const uniqueNumbers = [...new Set(numbers)];

  let targetNumber = null;
  if (uniqueNumbers.length === 1) {
    targetNumber = uniqueNumbers[0];
  } else {
    const primary = (gameState.whatsappConfig || []).find((r) => r.primary);
    if (primary) {
      targetNumber = primary.number.replace(/\D/g, "");
    } else {
      await showAlert(
        "Selected tickets belong to different WhatsApp ranges and no primary number is set. Please contact host.",
      );
      return;
    }
  }

  const message = encodeURIComponent(
    `Hi, I want to book tickets: ${selectedTickets.join(", ")} (${playerName})`,
  );
  const url = `https://wa.me/${targetNumber}?text=${message}`;
  window.open(url, "_blank");

  selectedTickets = [];
  document.getElementById("selectedCount").textContent = 0;
}

function renderHostGameInfo() {
  const container = document.getElementById("hostGameInfo");
  if (!container) return;
  if (gameState.status === "NO_ACTIVE_GAME") {
    container.style.display = "none";
    return;
  }
  let html = `
    <div class="collapsible-header" onclick="toggleHostInfoCollapse()">
      <h3>${gameState.gameName || "Tambola Game"}</h3>
      <span class="collapse-icon">${hostInfoCollapsed ? "▶" : "▼"}</span>
    </div>
    <div id="hostInfoContent" class="collapsible-content ${hostInfoCollapsed ? "collapsed" : ""}">
      <div class="prize-categories">
  `;
  gameState.prizeCategories.forEach((cat) => {
    html += `<div class="prize-category">`;
    html += `<h4>${cat.name}</h4>`;
    cat.prizes.forEach((prize) => {
      const awarded = prize.awarded ? "awarded" : "";
      html += `<div class="prize-item ${awarded}">`;
      html += `<span>${prize.title}</span>`;
      html += `<span>₹${prize.amount}</span>`;
      if (prize.awarded) html += ` 🏆`;
      html += `</div>`;
    });
    html += `</div>`;
  });
  html += `
      </div>
    </div>
    <div style="text-align: center; margin: 1rem 0;">
      <button id="releaseTicketsBtn" class="btn success" ${gameState.visibleToPlayers ? "disabled" : ""}>📢 Release Tickets to Players</button>
    </div>
  `;
  container.innerHTML = html;
  container.style.display = "block";

  document.getElementById("releaseTicketsBtn").addEventListener("click", () => {
    socket.emit("host:releaseTickets");
    document.getElementById("releaseTicketsBtn").disabled = true;
  });
}

function toggleHostInfoCollapse() {
  hostInfoCollapsed = !hostInfoCollapsed;
  renderHostGameInfo();
}

function renderPlayerPrizeInfo() {
  const container = document.getElementById("playerPrizeInfo");
  if (!container) return;
  if (gameState.status === "NO_ACTIVE_GAME") {
    container.style.display = "none";
    return;
  }
  let html = `
    <div class="collapsible-header" onclick="togglePlayerInfoCollapse()">
      <h3>${gameState.gameName || "Tambola Game"}</h3>
      <span class="collapse-icon">${playerInfoCollapsed ? "▶" : "▼"}</span>
    </div>
    <div id="playerInfoContent" class="collapsible-content ${playerInfoCollapsed ? "collapsed" : ""}">
      <div class="prize-categories">
  `;
  gameState.prizeCategories.forEach((cat) => {
    html += `<div class="prize-category">`;
    html += `<h4>${cat.name}</h4>`;
    cat.prizes.forEach((prize) => {
      const awarded = prize.awarded ? "awarded" : "";
      html += `<div class="prize-item ${awarded}">`;
      html += `<span>${prize.title}</span>`;
      html += `<span>₹${prize.amount}</span>`;
      if (prize.awarded) html += ` 🏆`;
      html += `</div>`;
    });
    html += `</div>`;
  });
  html += `
      </div>
    </div>
  `;
  container.innerHTML = html;
  container.style.display = "block";
}

function togglePlayerInfoCollapse() {
  playerInfoCollapsed = !playerInfoCollapsed;
  renderPlayerPrizeInfo();
}

function renderCalledNumbers(view) {
  const gridId =
    view === "host" ? "calledNumbersGrid" : "playerCalledNumbersGrid";
  const grid = document.getElementById(gridId);
  if (!grid) return;
  let html = "";
  for (let i = 1; i <= 90; i++) {
    const called = gameState.calledNumbers.includes(i) ? "called" : "";
    html += `<div class="number-cell ${called}">${i}</div>`;
  }
  grid.innerHTML = html;
  const countId = view === "host" ? "calledCount" : "playerCalledCountDisplay";
  const countElem = document.getElementById(countId);
  if (countElem) countElem.textContent = `${gameState.calledNumbers.length}/90`;
}

function renderWinners(view) {
  const listId = view === "host" ? "hostWinnersList" : "playerWinnersList";
  const sectionId =
    view === "host" ? "hostWinnersSection" : "playerWinnersSection";
  const progressId =
    view === "host" ? "hostWinnersProgress" : "playerWinnersProgress";
  const list = document.getElementById(listId);
  const section = document.getElementById(sectionId);
  const progress = document.getElementById(progressId);
  if (!list || !section || !progress) return;

  const winners = gameState.winners || [];
  const totalPrizes = gameState.prizeCategories.reduce(
    (acc, cat) => acc + cat.prizes.length,
    0,
  );

  if (winners.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  progress.style.width = `${(winners.length / totalPrizes) * 100}%`;

  let html = "";
  winners.forEach((w, index) => {
    let medal = "🏅";
    let cardClass = "winner-card";
    if (index === 0) {
      medal = "🥇";
      cardClass += " first";
    } else if (index === 1) {
      medal = "🥈";
      cardClass += " second";
    } else if (index === 2) {
      medal = "🥉";
      cardClass += " third";
    }
    html += `
      <div class="${cardClass}">
        <div class="winner-medal">${medal}</div>
        <div class="winner-details">
          <div class="winner-order">${w.pattern} - ${w.prizeTitle}</div>
          <div class="winner-name">${w.playerName || "Unknown"}</div>
          <div class="winner-ticket">${w.ticketId}</div>
        </div>
        <div class="winner-actions">
          <button class="view-btn" onclick="showWinnerModal('${w.ticketId}', ${w.winTimestamp})">👁️ View</button>
        </div>
      </div>
    `;
  });

  list.innerHTML = html;

  if (view === "host") {
    document.getElementById("printWinnersPdfBtn").style.display =
      "inline-block";
  } else {
    const btn = document.getElementById("printWinnersPdfBtn");
    if (btn) btn.style.display = "none";
  }
}

function renderTickets(view) {
  const isHost = view === "host";
  const gridId = isHost ? "ticketsGrid" : "playerTicketsGrid";
  const noResultsId = isHost ? null : "playerNoResults";
  const grid = document.getElementById(gridId);
  const noResults = noResultsId ? document.getElementById(noResultsId) : null;
  if (!grid) return;

  // Build map of called numbers at win for each ticket (used only in modal, not for grid)
  const winnerCalledMap = {};
  gameState.winners.forEach((winner) => {
    winnerCalledMap[winner.ticketId] = winner.calledNumbersAtWin || [];
  });

  const searchTerm = isHost ? hostSearchTerm : playerSearchTerm;
  let filtered = gameState.tickets;

  if (isHost && hostFilter !== "all") {
    if (hostFilter === "available") {
      filtered = filtered.filter(
        (t) => !t.isBooked && !t.isPending && !t.isFullHousieWinner,
      );
    } else if (hostFilter === "booked") {
      filtered = filtered.filter((t) => t.isBooked && !t.isFullHousieWinner);
    } else if (hostFilter === "pending") {
      filtered = filtered.filter((t) => t.isPending && !t.isFullHousieWinner);
    }
  }

  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(
      (t) =>
        t.id.toLowerCase().includes(term) ||
        (t.bookedBy && t.bookedBy.toLowerCase().includes(term)) ||
        (t.pendingPlayerName &&
          t.pendingPlayerName.toLowerCase().includes(term)),
    );
  }

  if (
    !isHost &&
    gameState.status === "BOOKING_OPEN" &&
    !gameState.visibleToPlayers
  ) {
    grid.innerHTML =
      '<div class="no-results">The system is creating tickets and will be released soon.</div>'; //original text: Tickets not yet released by host
    grid.style.display = "flex"; // <-- ADD THIS LINE
    if (noResults) noResults.style.display = "none";
    return;
  }

  if (filtered.length === 0) {
    if (noResults) {
      grid.style.display = "none";
      noResults.style.display = "block";
      noResults.textContent = searchTerm
        ? "No tickets match your search"
        : "No tickets available";
    } else {
      grid.innerHTML = '<div class="no-results">No tickets</div>';
    }
    return;
  }

  if (noResults) noResults.style.display = "none";
  grid.style.display = "flex";

  const winningTicketIds = new Set(gameState.winners.map((w) => w.ticketId));

  let html = "";
  filtered.forEach((t) => {
    if (isHost) {
      let cardClass = "ticket-card";
      let statusText = "";
      let statusClass = "";

      if (t.isFullHousieWinner) {
        cardClass += " winner";
        statusText = `🏆 WINNER #${t.fullHousieOrder}`;
        statusClass = "status-winner";
      } else if (t.isBooked) {
        cardClass += " booked";
        statusText = `📌 ${t.bookedBy}`;
        statusClass = "status-booked";
      } else if (t.isPending) {
        cardClass += " pending";
        statusText = `⏳ ${t.pendingPlayerName}`;
        statusClass = "status-pending";
      } else {
        cardClass += " available";
        statusText = "⚡ Available";
        statusClass = "status-available";
      }

      // Add selected class if in selection array (full card highlight)
      if (
        (hostFilter === "available" && hostSelectedUnbooked.includes(t.id)) ||
        (hostFilter === "pending" && hostSelectedPending.includes(t.id))
      ) {
        cardClass += " selected";
      }

      html += `<div class="${cardClass}" id="ticket-${t.id}">`;

      html += `<div class="ticket-header">`;
      html += `<span class="ticket-id">${t.id}</span>`;
      html += `<span class="ticket-status ${statusClass}">${statusText}</span>`;
      html += `</div>`;

      // Always use live called numbers for highlighting
      const highlightSet = gameState.calledNumbers;

      // Add clickable numbers grid with data attribute for selection
      html += `<div class="ticket-numbers clickable" data-ticket-id="${t.id}" onclick="hostTicketClick('${t.id}', event)">`;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 9; c++) {
          const num = t.numbers[r][c];
          if (num === 0) {
            html += `<div class="ticket-num empty"></div>`;
          } else {
            const marked = highlightSet.includes(num) ? "marked" : "";
            html += `<div class="ticket-num ${marked}">${num}</div>`;
          }
        }
      }
      html += `</div>`;

      if (
        gameState.status === "BOOKING_OPEN" &&
        !t.isBooked &&
        !t.isPending &&
        !t.isFullHousieWinner
      ) {
        if (activeBookingTicketId === t.id) {
          html += `
            <div class="inline-form">
              <input type="text" id="inline-name-${t.id}" class="input" placeholder="Player name" autofocus>
              <div class="button-group" style="margin-top:0.5rem;">
                <button class="btn success" onclick="confirmInlineBooking('${t.id}')">✅ Confirm</button>
                <button class="btn danger" onclick="cancelInlineBooking()">❌ Cancel</button>
              </div>
            </div>
          `;
        } else {
          html += `
            <div class="ticket-actions-row">
              <button class="btn secondary small" onclick="openInlineBooking('${t.id}')">📌 Book</button>
              <button class="btn danger small" onclick="deleteTicket('${t.id}')">🗑️ Delete</button>
            </div>
          `;
        }
      } else if (activeEditTicketId === t.id) {
        html += `
          <div class="inline-form">
            <input type="text" id="inline-edit-${t.id}" class="input" value="${t.bookedBy || ""}" placeholder="New player name" autofocus>
            <div class="button-group" style="margin-top:0.5rem;">
              <button class="btn success" onclick="confirmInlineEdit('${t.id}')">💾 Save</button>
              <button class="btn danger" onclick="cancelInlineEdit()">❌ Cancel</button>
            </div>
          </div>
        `;
      } else if (t.isPending && !t.isFullHousieWinner) {
        html += `
          <div class="pending-info">
            <div class="pending-header">⏳ Pending: ${t.pendingPlayerName}</div>
            <div class="pending-actions">
              <div class="button-group">
                <button class="btn success" onclick="confirmPending('${t.id}')">✓ Confirm</button>
                <button class="btn danger" onclick="cancelPending('${t.id}')">✗ Cancel</button>
              </div>
            </div>
          </div>
        `;
      } else if (gameState.status === "BOOKING_OPEN" && !t.isFullHousieWinner) {
        if (t.isBooked) {
          html += `<div class="button-group" style="margin-top:0.5rem;">`;
          html += `<button class="btn primary" onclick="openInlineEdit('${t.id}', '${t.bookedBy}')">✏️ Edit</button>`;
          html += `<button class="btn danger" onclick="unbookTicket('${t.id}')">🗑️ Unbook</button>`;
          html += `</div>`;
        }
      }

      html += `</div>`;
    } else {
      // Player view
      // (already handled "not released" condition above)

      let cardClass = "ticket-card";
      let statusClass = "status-available";
      let statusText = "⚡ Available";

      if (t.isFullHousieWinner) {
        cardClass += " winner";
        statusClass = "status-winner";
        statusText = `🏆 WINNER #${t.fullHousieOrder}`;
      } else if (t.isBooked) {
        cardClass += " booked";
        statusClass = "status-booked";
        statusText = `📌 ${t.bookedBy || "Booked"}`;
      } else if (t.isPending) {
        cardClass += " pending";
        statusClass = "status-pending";
        statusText = `⏳ Pending: ${t.pendingPlayerName}`;
      }

      html += `<div class="${cardClass}">`;
      html += `<div class="ticket-header"><span class="ticket-id">${t.id}</span>`;
      html += `<span class="ticket-status ${statusClass}">${statusText}</span></div>`;

      // Always use live called numbers for highlighting
      const highlightSet = gameState.calledNumbers;

      html += `<div class="ticket-numbers">`;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 9; c++) {
          const num = t.numbers[r][c];
          if (num === 0) {
            html += `<div class="ticket-num empty"></div>`;
          } else {
            const marked = highlightSet.includes(num) ? "marked" : "";
            html += `<div class="ticket-num ${marked}">${num}</div>`;
          }
        }
      }
      html += `</div>`;

      if (
        gameState.status === "BOOKING_OPEN" &&
        !t.isBooked &&
        !t.isPending &&
        !t.isFullHousieWinner
      ) {
        html += `<button class="wa-book-btn" onclick="requestBookingViaWhatsApp('${t.id}')">📲 Book via WhatsApp</button>`;
      }

      html += `</div>`;
    }
  });

  grid.innerHTML = html;
}

// Host click on ticket numbers grid to select/deselect
function hostTicketClick(ticketId, event) {
  // Stop propagation so that clicks on buttons don't trigger selection
  event.stopPropagation();
  if (gameState.status !== "BOOKING_OPEN") return;
  const ticket = gameState.tickets.find((t) => t.id === ticketId);
  if (!ticket) return;

  if (
    hostFilter === "available" &&
    !ticket.isBooked &&
    !ticket.isPending &&
    !ticket.isFullHousieWinner
  ) {
    const idx = hostSelectedUnbooked.indexOf(ticketId);
    if (idx === -1) hostSelectedUnbooked.push(ticketId);
    else hostSelectedUnbooked.splice(idx, 1);
  } else if (
    hostFilter === "pending" &&
    ticket.isPending &&
    !ticket.isFullHousieWinner
  ) {
    const idx = hostSelectedPending.indexOf(ticketId);
    if (idx === -1) hostSelectedPending.push(ticketId);
    else hostSelectedPending.splice(idx, 1);
  }
  renderHost();
}

// Select/Deselect all visible tickets in current filter (toggle)
function selectAllVisible() {
  if (hostFilter === "available") {
    const visible = gameState.tickets.filter(
      (t) => !t.isBooked && !t.isPending && !t.isFullHousieWinner,
    );
    const visibleIds = visible.map((t) => t.id);
    // If all visible are selected, deselect them; otherwise select all
    const allSelected = visibleIds.every((id) =>
      hostSelectedUnbooked.includes(id),
    );
    if (allSelected) {
      hostSelectedUnbooked = hostSelectedUnbooked.filter(
        (id) => !visibleIds.includes(id),
      );
    } else {
      hostSelectedUnbooked = [
        ...new Set([...hostSelectedUnbooked, ...visibleIds]),
      ];
    }
  } else if (hostFilter === "pending") {
    const visible = gameState.tickets.filter(
      (t) => t.isPending && !t.isFullHousieWinner,
    );
    const visibleIds = visible.map((t) => t.id);
    const allSelected = visibleIds.every((id) =>
      hostSelectedPending.includes(id),
    );
    if (allSelected) {
      hostSelectedPending = hostSelectedPending.filter(
        (id) => !visibleIds.includes(id),
      );
    } else {
      hostSelectedPending = [
        ...new Set([...hostSelectedPending, ...visibleIds]),
      ];
    }
  }
  renderHost();
}

async function deleteSelectedUnbooked() {
  if (hostSelectedUnbooked.length === 0) return;
  if (
    await showConfirm(`Delete ${hostSelectedUnbooked.length} unbooked tickets?`)
  ) {
    socket.emit("host:deleteTickets", { ticketIds: hostSelectedUnbooked });
    hostSelectedUnbooked = [];
  }
}

async function cancelSelectedPending() {
  if (hostSelectedPending.length === 0) return;
  if (
    await showConfirm(`Cancel ${hostSelectedPending.length} pending bookings?`)
  ) {
    socket.emit("host:cancelPendingTickets", {
      ticketIds: hostSelectedPending,
    });
    hostSelectedPending = [];
  }
}

async function deleteTicket(ticketId) {
  if (await showConfirm(`Delete ticket ${ticketId}? This cannot be undone.`)) {
    socket.emit("host:deleteTicket", { ticketId });
  }
}

function renderWizard() {
  const wizardContainer = document.getElementById("wizardContainer");
  let html = "";

  const hasWhatsApp =
    gameState.whatsappConfig && gameState.whatsappConfig.length > 0;

  if (wizardStep === 1) {
    html = `
      <h3>[ STEP 1 ] [ Basic Information ]</h3>
      ${!hasWhatsApp ? '<p style="color:var(--danger)">⚠️ Please configure WhatsApp numbers first.</p>' : ""}
      <input type="text" id="wizardGameName" class="input" placeholder="Game Name *" value="${wizardConfig.gameName}" ${!hasWhatsApp ? "disabled" : ""}>
      <input type="number" id="wizardTicketCount" class="input" value="${wizardConfig.ticketCount}" min="1" max="1000" ${!hasWhatsApp ? "disabled" : ""}>
      <button id="wizardNext1" class="btn primary" ${!wizardConfig.gameName || !hasWhatsApp ? "disabled" : ""}>Next</button>
    `;
  } else if (wizardStep === 2) {
    html = `
      <h3>[ STEP 2 ] [ Prize Categories ]</h3>
      <div id="prizeCategoriesContainer"></div>
      <div class="button-group" style="margin-top:20px">
        <button id="wizardBack2" class="btn secondary">Back</button>
        <button id="wizardNext2" class="btn primary">Next</button>
      </div>
    `;
  } else if (wizardStep === 3) {
    html = `
      <h3>[ Step 3 ] [ Create Game ]</h3>
      <p>Review your configuration and create the game.</p>
      <div><strong>Game Name:</strong> ${wizardConfig.gameName}</div>
      <div><strong>Tickets:</strong> ${wizardConfig.ticketCount}</div>
      <div><strong>Prize Categories:</strong> ${wizardConfig.prizeCategories.map((c) => `${c.name} (${c.prizes.length} prizes)`).join(", ")}</div>
      <div class="button-group" style="margin-top:20px">
        <button id="wizardBack3" class="btn secondary">Back</button>
        <button id="wizardCreateGame" class="btn success">Create Game</button>
      </div>
    `;
  }

  wizardContainer.innerHTML = html;

  if (wizardStep === 1) {
    const gameNameInput = document.getElementById("wizardGameName");
    if (gameNameInput) {
      gameNameInput.addEventListener("input", (e) => {
        wizardConfig.gameName = e.target.value;
        document.getElementById("wizardNext1").disabled =
          !wizardConfig.gameName || !hasWhatsApp;
      });
    }
    const ticketCountInput = document.getElementById("wizardTicketCount");
    if (ticketCountInput) {
      ticketCountInput.addEventListener("input", (e) => {
        wizardConfig.ticketCount = parseInt(e.target.value) || 50;
      });
    }
    document.getElementById("wizardNext1").addEventListener("click", () => {
      wizardStep = 2;
      renderWizard();
    });
  } else if (wizardStep === 2) {
    renderPrizeCategories();
    document.getElementById("wizardBack2").addEventListener("click", () => {
      wizardStep = 1;
      renderWizard();
    });
    document.getElementById("wizardNext2").addEventListener("click", () => {
      if (!validatePrizeCategories()) {
        showAlert(
          "Please add at least one prize for each selected category, and ensure all prizes have a title and amount > 0.",
        );
        return;
      }
      wizardStep = 3;
      renderWizard();
    });
  } else if (wizardStep === 3) {
    document.getElementById("wizardBack3").addEventListener("click", () => {
      wizardStep = 2;
      renderWizard();
    });
    document
      .getElementById("wizardCreateGame")
      .addEventListener("click", () => {
        socket.emit("host:createGameWithConfig", {
          gameName: wizardConfig.gameName,
          visibleToPlayers: true,
          ticketCount: wizardConfig.ticketCount,
          prizeCategories: wizardConfig.prizeCategories,
        });
        wizardStep = 1;
        wizardConfig = {
          gameName: "",
          visibleToPlayers: true,
          ticketCount: 50,
          prizeCategories: [],
        };
      });
  }
}

function renderPrizeCategories() {
  const container = document.getElementById("prizeCategoriesContainer");
  // Added "Early Seven" to the list
  const categories = [
    "Early Five",
    "Early Seven",
    "Top Line",
    "Middle Line",
    "Bottom Line",
    "Full House",
    "Corners",
  ];

  let html = "";
  categories.forEach((cat) => {
    const catConfig = wizardConfig.prizeCategories.find(
      (c) => c.name === cat,
    ) || {
      name: cat,
      prizes: [],
    };
    const checked = catConfig.prizes.length > 0 ? "checked" : "";
    html += `
      <div class="prize-category-card">
        <label style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" class="category-checkbox" data-category="${cat}" ${checked}> ${cat}
        </label>
        <div class="prizes-for-category" id="prizes-${cat}" style="${checked ? "display:block" : "display:none"}">
          <div class="prize-list"></div>
          <button class="btn secondary add-prize-btn" data-category="${cat}">+ Add Prize</button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;

  document.querySelectorAll(".category-checkbox").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const cat = e.target.dataset.category;
      const div = document.getElementById(`prizes-${cat}`);
      if (e.target.checked) {
        div.style.display = "block";
        let catPrizes = wizardConfig.prizeCategories.find(
          (c) => c.name === cat,
        );
        if (!catPrizes) {
          catPrizes = {
            name: cat,
            prizes: [{ title: "", amount: 0 }],
          };
          wizardConfig.prizeCategories.push(catPrizes);
        }
      } else {
        div.style.display = "none";
        wizardConfig.prizeCategories = wizardConfig.prizeCategories.filter(
          (c) => c.name !== cat,
        );
      }
      renderPrizesForCategory(cat);
    });
  });

  wizardConfig.prizeCategories.forEach((cat) => {
    renderPrizesForCategory(cat.name);
  });

  document.querySelectorAll(".add-prize-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const cat = e.target.dataset.category;
      const catConfig = wizardConfig.prizeCategories.find(
        (c) => c.name === cat,
      );
      if (catConfig) {
        catConfig.prizes.push({ title: "", amount: 0 });
        renderPrizesForCategory(cat);
      }
    });
  });
}

function renderPrizesForCategory(categoryName) {
  const container = document.getElementById(`prizes-${categoryName}`);
  if (!container) return;
  const catConfig = wizardConfig.prizeCategories.find(
    (c) => c.name === categoryName,
  );
  if (!catConfig) return;

  let html = '<div class="prize-list">';
  catConfig.prizes.forEach((prize, index) => {
    html += `
      <div class="prize-item">
        <input type="text" class="input prize-title" data-category="${categoryName}" data-index="${index}" placeholder="Prize Title" value="${prize.title}">
        <input type="number" class="input prize-amount" data-category="${categoryName}" data-index="${index}" placeholder="Amount" value="${prize.amount ? prize.amount : ""}" min="0">
        <button class="btn danger remove-prize-btn" data-category="${categoryName}" data-index="${index}">✖</button>
      </div>
    `;
  });
  html += "</div>";
  const existingList = container.querySelector(".prize-list");
  if (existingList) {
    existingList.outerHTML = html;
  } else {
    container.insertAdjacentHTML("afterbegin", html);
  }

  container.querySelectorAll(".prize-title").forEach((input) => {
    input.addEventListener("input", (e) => {
      const cat = e.target.dataset.category;
      const idx = e.target.dataset.index;
      const catConfig = wizardConfig.prizeCategories.find(
        (c) => c.name === cat,
      );
      if (catConfig) catConfig.prizes[idx].title = e.target.value;
    });
  });
  container.querySelectorAll(".prize-amount").forEach((input) => {
    input.addEventListener("input", (e) => {
      const cat = e.target.dataset.category;
      const idx = e.target.dataset.index;
      const catConfig = wizardConfig.prizeCategories.find(
        (c) => c.name === cat,
      );
      if (catConfig)
        catConfig.prizes[idx].amount = parseFloat(e.target.value) || 0;
    });
  });
  container.querySelectorAll(".remove-prize-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const cat = e.target.dataset.category;
      const idx = e.target.dataset.index;
      const catConfig = wizardConfig.prizeCategories.find(
        (c) => c.name === cat,
      );
      if (catConfig) {
        catConfig.prizes.splice(idx, 1);
        renderPrizesForCategory(cat);
      }
    });
  });
}

function validatePrizeCategories() {
  for (const cat of wizardConfig.prizeCategories) {
    if (cat.prizes.length === 0) return false;
    for (const prize of cat.prizes) {
      if (!prize.title.trim()) return false;
      if (prize.amount <= 0) return false;
    }
  }
  return true;
}

async function requestBookingViaWhatsApp(ticketId) {
  const playerName = await showPrompt("Enter your name to book this ticket:");
  if (!playerName || playerName.trim() === "") return;

  socket.emit("player:requestBooking", {
    ticketId,
    playerName: playerName.trim(),
  });

  const number = getWhatsAppNumberForTicket(ticketId);
  console.log("WhatsApp number for ticket", ticketId, ":", number);

  if (!number) {
    await showAlert(
      "No WhatsApp number configured for this ticket range. Please contact host.",
    );
    return;
  }

  const message = encodeURIComponent(
    `Hi, I want to book ticket ${ticketId} (${playerName})`,
  );
  const url = `https://wa.me/${number}?text=${message}`;
  console.log("Opening URL:", url);
  window.open(url, "_blank");
}

function confirmPending(ticketId) {
  socket.emit("host:confirmPending", { ticketId });
}

function cancelPending(ticketId) {
  socket.emit("host:cancelPending", { ticketId });
}

function openInlineBooking(ticketId) {
  activeBookingTicketId = ticketId;
  activeEditTicketId = null;
  renderHost();
  setTimeout(() => {
    const input = document.getElementById(`inline-name-${ticketId}`);
    if (input) input.focus();
  }, 50);
}

function confirmInlineBooking(ticketId) {
  const input = document.getElementById(`inline-name-${ticketId}`);
  const name = input ? input.value.trim() : "";
  if (!name) {
    showAlert("Please enter a player name");
    return;
  }
  socket.emit("host:bookTicket", { ticketId, playerName: name });
  activeBookingTicketId = null;
  renderHost();
}

function cancelInlineBooking() {
  activeBookingTicketId = null;
  renderHost();
}

function openInlineEdit(ticketId, currentName) {
  activeEditTicketId = ticketId;
  activeBookingTicketId = null;
  renderHost();
  setTimeout(() => {
    const input = document.getElementById(`inline-edit-${ticketId}`);
    if (input) {
      input.value = currentName;
      input.focus();
    }
  }, 50);
}

function confirmInlineEdit(ticketId) {
  const input = document.getElementById(`inline-edit-${ticketId}`);
  const name = input ? input.value.trim() : "";
  if (!name) {
    showAlert("Please enter a player name");
    return;
  }
  socket.emit("host:editBooking", { ticketId, newPlayerName: name });
  activeEditTicketId = null;
  renderHost();
}

function cancelInlineEdit() {
  activeEditTicketId = null;
  renderHost();
}

function unbookTicket(ticketId) {
  socket.emit("host:unbookTicket", { ticketId });
}

function speak(text) {
  if (!window.speechSynthesis) return;
  if (currentUtterance) window.speechSynthesis.cancel();
  currentUtterance = new SpeechSynthesisUtterance(text);
  currentUtterance.lang = "en-US";
  currentUtterance.rate = 1;
  window.speechSynthesis.speak(currentUtterance);
}

function handleCountdownTimer() {
  if (countdownInterval) clearInterval(countdownInterval);
  if (gameState.status !== "COUNTDOWN" || !gameState.countdownEndTime) return;

  lastSpokenCountdownSecond = -1;

  const updateCountdown = () => {
    const remaining = Math.max(
      0,
      Math.floor((gameState.countdownEndTime - Date.now()) / 1000),
    );
    document.getElementById("hostCountdownNumber").textContent = remaining;
    document.getElementById("playerCountdownNumber").textContent = remaining;
    return remaining;
  };

  updateCountdown();

  countdownInterval = setInterval(() => {
    const remaining = updateCountdown();

    if (
      remaining <= 5 &&
      remaining > 0 &&
      remaining !== lastSpokenCountdownSecond
    ) {
      speak(remaining.toString());
      lastSpokenCountdownSecond = remaining;
    } else if (remaining === 0 && lastSpokenCountdownSecond !== 0) {
      speak("Game started!");
      lastSpokenCountdownSecond = 0;
    }

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }, 500);
}

function showPopupNumber(number) {
  if (isHostAuthenticated) return;
  const container = document.getElementById("popupContainer");
  const popup = document.createElement("div");
  popup.className = "popup-number";
  popup.textContent = number;
  container.appendChild(popup);
  setTimeout(() => popup.remove(), 2000);
}

function updateStickyNumber(number) {
  document.getElementById("hostCurrentNumberValue").textContent = number;
  document.getElementById("playerCurrentNumberValue").textContent = number;
}

function toggleWinnersVisibility() {
  const hostWinners = document.getElementById("hostWinnersSection");
  const playerWinners = document.getElementById("playerWinnersSection");
  const hasWinners = gameState.winners.length > 0;
  if (hostWinners) hostWinners.style.display = hasWinners ? "block" : "none";
  if (playerWinners)
    playerWinners.style.display = hasWinners ? "block" : "none";
}

function updateStatusBadges() {
  const badges = ["statusBadge", "playerStatusBadge"];
  badges.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = gameState.status.replace(/_/g, " ");
      el.className = "badge";
      if (gameState.status === "BOOKING_OPEN") el.classList.add("booking");
      else if (gameState.status === "COUNTDOWN") el.classList.add("countdown");
      else if (gameState.status === "RUNNING") el.classList.add("running");
      else if (gameState.status === "COMPLETED") el.classList.add("completed");
    }
  });
}

function showGameOverOverlay() {
  const overlay = document.getElementById("gameOverOverlay");
  if (!overlay) return;

  if (gameState.status === "COMPLETED") {
    const reason = gameState.gameEndReason || "Game ended";
    document.getElementById("gameOverReason").textContent = reason.replace(
      /_/g,
      " ",
    );
    overlay.classList.add("show");

    if (gameOverTimer) clearTimeout(gameOverTimer);
    gameOverTimer = setTimeout(() => {
      overlay.classList.remove("show");
    }, 5000);
  } else {
    overlay.classList.remove("show");
    if (gameOverTimer) {
      clearTimeout(gameOverTimer);
      gameOverTimer = null;
    }
  }
}

function showWinnerModal(ticketId, winTimestamp) {
  const ticket = gameState.tickets.find((t) => t.id === ticketId);
  let winner;
  if (winTimestamp !== undefined) {
    winner = gameState.winners.find(
      (w) => w.ticketId === ticketId && w.winTimestamp === winTimestamp,
    );
  } else {
    winner = gameState.winners.find((w) => w.ticketId === ticketId);
  }
  if (!ticket || !winner) return;

  const modal = document.getElementById("winnerModal");
  document.getElementById("modalWinnerInfo").innerHTML = `
    <div><strong>${winner.playerName}</strong> - ${ticketId}</div>
    <div>${winner.pattern} - ${winner.prizeTitle}</div>
  `;
  let gridHtml = "";
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 9; c++) {
      const num = ticket.numbers[r][c];
      if (num === 0) {
        gridHtml += '<div class="modal-ticket-cell empty"></div>';
      } else {
        const marked = winner.calledNumbersAtWin.includes(num) ? "marked" : "";
        gridHtml += `<div class="modal-ticket-cell ${marked}">${num}</div>`;
      }
    }
  }
  document.getElementById("modalTicketGrid").innerHTML = gridHtml;
  document.getElementById("modalCalledList").innerHTML =
    `<strong>Called at win:</strong> ${winner.calledNumbersAtWin.join(", ")}`;
  modal.classList.add("show");
}

function showTicketGridModal() {
  const modal = document.getElementById("ticketGridModal");
  const container = document.getElementById("ticketGridContainer");
  if (!container) return;
  let html = "";
  gameState.tickets.forEach((t) => {
    const num = t.id.split("-")[1];
    let bookedClass = "";
    if (t.isBooked) bookedClass = "booked";
    else if (t.isPending) bookedClass = "pending";
    html += `<div class="ticket-grid-item ${bookedClass}">${num}</div>`;
  });
  container.innerHTML = html;
  modal.classList.add("show");
}

function printPdfFromGrid() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  doc.setFontSize(16);
  doc.text("Ticket Grid", 105, 15, { align: "center" });
  doc.setFontSize(10);

  const total = gameState.tickets.length;
  const cols = 10;
  const cellSize = 15;
  const startX = 20;
  const startY = 30;
  const ticketsPerPage = Math.floor((280 - startY) / cellSize) * cols;

  let page = 1;
  for (let i = 0; i < total; i++) {
    if (i > 0 && i % ticketsPerPage === 0) {
      doc.addPage();
      page++;
      doc.setFontSize(16);
      doc.text("Ticket Grid", 105, 15, { align: "center" });
      doc.setFontSize(10);
    }
    const ticket = gameState.tickets[i];
    const col = i % cols;
    const rowOnPage =
      Math.floor(i / cols) - (page - 1) * Math.floor(ticketsPerPage / cols);
    const x = startX + col * cellSize;
    const y = startY + rowOnPage * cellSize;

    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.rect(x, y, cellSize, cellSize);
    if (ticket.isBooked) {
      doc.setFillColor(198, 246, 213);
      doc.rect(x, y, cellSize, cellSize, "F");
    } else if (ticket.isPending) {
      doc.setFillColor(255, 243, 205);
      doc.rect(x, y, cellSize, cellSize, "F");
    }
    doc.setTextColor(0);
    doc.text(ticket.id.split("-")[1], x + cellSize / 2, y + cellSize / 2, {
      align: "center",
      baseline: "middle",
    });
  }

  const pdfBlob = doc.output("blob");
  const pdfUrl = URL.createObjectURL(pdfBlob);
  window.open(pdfUrl);
}

function switchTab(tabId) {
  document
    .querySelectorAll(".nav-btn")
    .forEach((btn) => btn.classList.remove("active"));
  document
    .querySelectorAll(".tab-pane")
    .forEach((pane) => pane.classList.remove("active"));

  document
    .querySelector(`.nav-btn[data-tab="${tabId}"]`)
    .classList.add("active");
  document.getElementById(`tab-${tabId}`).classList.add("active");

  currentTab = tabId;
}

// Collapsible nav bar – now toggles the tab content, not the navbar
function toggleNavCollapse() {
  tabContentCollapsed = !tabContentCollapsed;
  const tabContent = document.getElementById("tabContent");
  tabContent.style.display = tabContentCollapsed ? "none" : "block";
}

document.addEventListener("DOMContentLoaded", () => {
  loadTheme();

  document.getElementById("loginBtn").addEventListener("click", () => {
    const user = document.getElementById("username").value.trim();
    const pass = document.getElementById("password").value.trim();
    if (!user || !pass) {
      document.getElementById("loginError").textContent =
        "Enter username and password";
      document.getElementById("loginError").style.display = "block";
      return;
    }
    document.getElementById("loginError").style.display = "none";
    socket.emit("host:login", { username: user, password: pass });
  });

  document.getElementById("logoutBtn").addEventListener("click", () => {
    isHostAuthenticated = false;
    localStorage.removeItem("hostAuth");
    localStorage.removeItem("hostUser");
    localStorage.removeItem("hostPass");
    document.getElementById("dashboard").style.display = "none";
    document.getElementById("loginScreen").style.display = "flex";
  });

  document.getElementById("startGameBtn").addEventListener("click", () => {
    const inline = document.getElementById("inlineCountdown");
    if (inline.style.display === "none" || inline.style.display === "") {
      inline.style.display = "block";
    } else {
      inline.style.display = "none";
    }
  });

  document
    .getElementById("confirmInlineCountdownBtn")
    .addEventListener("click", () => {
      const input = document.getElementById("inlineCountdownInput").value;
      document.getElementById("inlineCountdown").style.display = "none";
      socket.emit("host:startCountdown", { duration: input });
    });

  document
    .getElementById("cancelInlineCountdownBtn")
    .addEventListener("click", () => {
      document.getElementById("inlineCountdown").style.display = "none";
    });

  document.querySelectorAll("#inlineCountdown .quick-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      document.getElementById("inlineCountdownInput").value =
        e.target.dataset.time;
    });
  });

  document
    .getElementById("resetGameBtn")
    .addEventListener("click", async () => {
      if (await showConfirm("Reset game? All data will be lost.")) {
        socket.emit("host:resetGame");
      }
    });

  document.getElementById("hostSearchInput").addEventListener("input", (e) => {
    hostSearchTerm = e.target.value;
    renderHost();
  });

  document
    .getElementById("playerSearchInput")
    .addEventListener("input", (e) => {
      playerSearchTerm = e.target.value;
      renderPlayer();
    });

  document
    .getElementById("generatePdfBtn")
    .addEventListener("click", showTicketGridModal);

  const bookedListBtn = document.getElementById("bookedListBtn");
  if (bookedListBtn) {
    bookedListBtn.addEventListener("click", openBookedListModal);
  }

  const printBookedListBtn = document.getElementById("printBookedListBtn");
  if (printBookedListBtn) {
    printBookedListBtn.addEventListener("click", printBookedList);
  }

  const printWinnersBtn = document.getElementById("printWinnersPdfBtn");
  if (printWinnersBtn) {
    printWinnersBtn.addEventListener("click", printWinnersPdf);
  }

  document
    .getElementById("cancelGridModalBtn")
    .addEventListener("click", () => {
      document.getElementById("ticketGridModal").classList.remove("show");
    });

  document.getElementById("printPdfBtn").addEventListener("click", () => {
    printPdfFromGrid();
  });

  document.getElementById("scheduleGameBtn").addEventListener("click", () => {
    const dateTimeStr = document.getElementById("scheduledStartInput").value;
    if (!dateTimeStr) {
      showAlert("Please select a date and time.");
      return;
    }
    const scheduledTime = new Date(dateTimeStr).getTime();
    socket.emit("host:scheduleCountdown", { scheduledTime });
  });

  document.getElementById("pauseCountdownBtn").addEventListener("click", () => {
    socket.emit("host:pauseCountdown");
  });

  document
    .getElementById("resumeCountdownBtn")
    .addEventListener("click", () => {
      socket.emit("host:resumeCountdown");
    });

  document.querySelectorAll(".close").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const modal = e.target.closest(".modal-overlay");
      if (modal) modal.classList.remove("show");
    });
  });

  document.getElementById("closeGameOverBtn")?.addEventListener("click", () => {
    document.getElementById("gameOverOverlay").classList.remove("show");
    if (gameOverTimer) {
      clearTimeout(gameOverTimer);
      gameOverTimer = null;
    }
  });

  window.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-overlay")) {
      e.target.classList.remove("show");
    }
  });

  const toggleGameCtrlBtn = document.getElementById("toggleGameControlBtn");
  const gameCtrlContent = document.getElementById("gameControlContent");
  if (toggleGameCtrlBtn && gameCtrlContent) {
    const isCollapsed = localStorage.getItem("gameControlCollapsed") === "true";
    if (isCollapsed) {
      gameCtrlContent.classList.add("collapsed");
      toggleGameCtrlBtn.textContent = "▶";
    }
    toggleGameCtrlBtn.addEventListener("click", () => {
      gameCtrlContent.classList.toggle("collapsed");
      toggleGameCtrlBtn.textContent = gameCtrlContent.classList.contains(
        "collapsed",
      )
        ? "▶"
        : "▼";
      localStorage.setItem(
        "gameControlCollapsed",
        gameCtrlContent.classList.contains("collapsed"),
      );
    });
  }

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      switchTab(e.target.dataset.tab);
    });
  });

  document
    .getElementById("bookSelectedBtn")
    .addEventListener("click", bookSelectedTickets);
  document
    .getElementById("clearSelectionBtn")
    .addEventListener("click", clearTicketSelection);

  document
    .getElementById("deleteSelectedUnbookedBtn")
    .addEventListener("click", deleteSelectedUnbooked);
  document
    .getElementById("cancelSelectedPendingBtn")
    .addEventListener("click", cancelSelectedPending);

  // Select All button
  const selectAllBtn = document.createElement("button");
  selectAllBtn.id = "selectAllBtn";
  selectAllBtn.className = "btn primary small";
  selectAllBtn.textContent = "Select All";
  selectAllBtn.style.display = "none";
  selectAllBtn.addEventListener("click", selectAllVisible);
  document.getElementById("hostBatchActions").appendChild(selectAllBtn);

  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.addEventListener("click", toggleTheme);
  });

  const viewAvailableBtn = document.getElementById("viewAvailableBtn");
  if (viewAvailableBtn) {
    viewAvailableBtn.addEventListener("click", showPlayerCompactGrid);
  }

  document
    .getElementById("closeCompactGridBtn")
    ?.addEventListener("click", () => {
      document
        .getElementById("playerCompactGridModal")
        .classList.remove("show");
    });

  // Cancel button for booked list modal
  const cancelBookedModalBtn = document.getElementById("cancelBookedModalBtn");
  if (cancelBookedModalBtn) {
    cancelBookedModalBtn.addEventListener("click", () => {
      document.getElementById("bookedListModal").classList.remove("show");
    });
  }

  updateUI();
});
