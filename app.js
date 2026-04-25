// --- Start of helper functions ---

// Prevent FOUC: Show body only after fonts load
(function() {
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            document.documentElement.classList.add('fonts-loaded');
            document.body.classList.add('fonts-loaded');
        });
    } else {
        // Fallback for browsers without Font Loading API
        window.addEventListener('load', () => {
            document.documentElement.classList.add('fonts-loaded');
            document.body.classList.add('fonts-loaded');
        });
    }
    
    // Timeout fallback: show content after 1s regardless of font status
    setTimeout(() => {
        if (!document.body.classList.contains('fonts-loaded')) {
            document.documentElement.classList.add('fonts-loaded');
            document.body.classList.add('fonts-loaded');
        }
    }, 1000);
})();

// ASCII title interaction - pop + random palette color on click
document.addEventListener("DOMContentLoaded", () => {
    const pre = document.querySelector(".ascii-title");
    if (!pre) return;

    const colors = [
        '#F33800', // red
        '#FF8200', // orange
        '#FFC500', // yellow
        '#72CA00', // lime
        '#009442', // green
        '#00BFBD', // cyan
        '#006CAD', // blue
        '#5E2AA6', // indigo
        '#B40075'  // violet
    ];

    pre.addEventListener("click", () => {
        const currentColor = (pre.dataset.paletteColor || '').toUpperCase();
        const availableColors = colors.filter(color => color !== currentColor);
        const nextColor = availableColors[Math.floor(Math.random() * availableColors.length)];

        pre.style.color = nextColor;
        pre.dataset.paletteColor = nextColor;
        triggerPop(pre);
    });
});

// Prevent focusing on element from scrolling the page
function safeFocus(el) {
  if (!el || !el.focus) return;
  try { el.focus({ preventScroll: true }); }  // modern browsers
  catch { el.focus(); }                        // older Safari
}

// Re-triggerable "pop" (uses existing .land-pop CSS)
function triggerPop(cell) {
  if (!cell) return;

  // Respect reduced motion
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  // Restart the animation if it's already running
  cell.classList.remove('land-pop');
  void cell.offsetWidth; // force reflow to re-trigger
  cell.classList.add('land-pop');

  // Clean up after the animation (~120ms)
  clearTimeout(cell._popTO);
  cell._popTO = setTimeout(() => {
    cell.classList.remove('land-pop');
  }, 140);
}

// Daily color: fetch from server (no client algorithm)
async function fetchDailyPuzzle() {
  const res = await fetch('/api/daily-color', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch daily color');
  const data = await res.json();
  const hex = String(data?.hex || '').toUpperCase();
  const date = data?.date || new Date().toISOString().split('T')[0];
  if (!/^[0-9A-F]{6}$/.test(hex)) throw new Error('Invalid daily color payload');
  return { hex, date };
}

// --- End of helper functions ---

// Tracks pending auto-popups so a manual open can cancel only the next
// scheduled auto-open for that same flow.
const autoPopupBypassState = {
    onboardingHelpAuto: { pending: false, suppressNext: false },
    statsOnLoadAuto: { pending: false, suppressNext: false },
    statsEndgameAuto: { pending: false, suppressNext: false }
};

function markAutoPopupBypassed(channel) {
    const state = autoPopupBypassState[channel];
    if (!state) return;
    if (state.pending) {
        state.suppressNext = true;
    }
}

function shouldSuppressAutoPopup(channel) {
    const state = autoPopupBypassState[channel];
    if (!state) return false;
    if (state.suppressNext) {
        state.suppressNext = false;
        return true;
    }
    return false;
}

class HexColorWordle {
    constructor(opts = {}) {
        this.mode = opts.mode || 'unlimited';
        this.targetColor = (opts.targetColor || this.generateRandomColor());
        this.dailyPuzzleDate = opts.dailyPuzzleDate || new Date().toISOString().split('T')[0];
        this.currentAttempt = 1;
        
        this.maxAttempts = 5;
        this.gameOver = false;
        this.colorVisible = false;
        this.hasRevealedThisAttempt = false;
        this.baseDuration = 1000; // 1 second for first attempt
        this.isAnimating = false; // Track if guess animation is playing
        
        // Track all guesses and their errors for statistics
        this.guessHistory = []; // Array of {hex, colorError}
        this.postGameActionRow = null;
        
        // Check if daily puzzle is already completed
        if (this.mode === 'daily') {
            const completionData = this.checkDailyCompletion();
            if (completionData.completed) {
                this.gameOver = true;
                this.dailyAlreadyCompleted = true;
                // Will show stats modal after initialization
            }
        }
                
        this.initializeElements();
        this.setupEventListeners();
        this.updateColorPicker();
        this.buildGrid();
        this.setupOnScreenKeyboard();
        
        // Restore daily game state AFTER grid is built
        if (this.mode === 'daily') {
            this.loadDailyGameState();
        }

        window.addEventListener('resize', this.handleResize);
        this.setupPickerLayoutSync();

        // keyboard input
        document.addEventListener('keydown', this.handleKeydown);
        
        // Document-level paste listener as fallback (catches paste even when grid isn't focused)
        document.addEventListener('paste', (e) => {
            // Only handle if we're not in an input field and game is active
            const active = document.activeElement;
            const isInInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
            if (!isInInput && active !== this.gridEl && !this.gameOver && !this.isAnimating) {
                this.handlePaste(e);
            }
        })

        // Info button listener will be handled by modal system
        
        // Show stats modal if daily puzzle already completed
        if (this.dailyAlreadyCompleted) {
            const autoChannel = 'statsOnLoadAuto';
            autoPopupBypassState[autoChannel].pending = true;
            setTimeout(() => {
                autoPopupBypassState[autoChannel].pending = false;
                if (shouldSuppressAutoPopup(autoChannel)) return;
                if (document.body.classList.contains('modal-open')) return; // Don't auto-open if another modal is open
                if (typeof window.showStatsModal === 'function') {
                    window.showStatsModal(true); // true = already completed
                }
            }, 1500); // Small delay for page load
        }
    }

    initializeElements() {
        this.colorDisplay = document.getElementById('colorDisplay');
        this.guessesContainer = document.getElementById('guessesContainer');
        this.timerBar  = document.getElementById('timerBar');
        this.timerFill = document.getElementById('timerFill');
                
        // Custom color picker elements
        this.colorCanvas = document.getElementById('colorCanvas');
        this.canvasCursor = document.getElementById('canvasCursor');
        this.hueSlider = document.getElementById('hueSlider');
        this.hueCursor = document.getElementById('hueCursor');
        this.colorPreview = document.getElementById('colorPreview');
        this.hexOutputField = document.getElementById('hexOutputField');
        this.copyBtn = document.getElementById('copyBtn');
    }
            
    buildGrid() {
        // Build a maxAttempts x 6 grid
        this.gridRows = this.maxAttempts;
        this.gridCols = 6;
        this.currentRow = 0;
        this.currentCol = 0;
        this.gridEl = document.getElementById('hexGrid');
        this.gridEl.style.setProperty('--grid-rows', String(this.gridRows));
        this.gridEl.innerHTML = '';
        this.gridCellRefs = [];

        this.rowLabels = [];
        this.rowActions = [];
        this.pasteButtons = [];
        this.rowActionModes = [];
        this.rowActionIcons = [];
        for (let r = 0; r < this.gridRows; r++) {
            const rowEl = document.createElement('div');
            rowEl.className = 'hex-grid-row';
            // left hashtag label
            const label = document.createElement('div');
            label.className = 'row-label';
            label.textContent = '#';
            rowEl.appendChild(label);
            this.rowLabels.push(label);
            const rowCells = [];
            for (let c = 0; c < this.gridCols; c++) {
                const cell = document.createElement('div');
                cell.className = 'grid-cell';
                rowEl.appendChild(cell);
                rowCells.push(cell);
            }

            // right-side paste action
            const action = document.createElement('div');
            action.className = 'row-action';
            const pasteBtn = document.createElement('button');
            pasteBtn.type = 'button';
            pasteBtn.className = 'paste-btn';
            pasteBtn.setAttribute('aria-label','Paste');
            const svgNS = 'http://www.w3.org/2000/svg';
            const pasteSvg = document.createElementNS(svgNS, 'svg');
            pasteSvg.setAttribute('class', 'icon icon--paste');
            pasteSvg.setAttribute('viewBox', '0 0 15 15');
            const use = document.createElementNS(svgNS, 'use');
            use.setAttribute('href', '#icon-paste');
            pasteSvg.appendChild(use);
            pasteBtn.appendChild(pasteSvg);
            action.appendChild(pasteBtn);
            rowEl.appendChild(action);
            this.rowActions.push(action);
            this.pasteButtons.push(pasteBtn);
            this.rowActionModes.push('paste');
            this.rowActionIcons.push(use);

            this.gridEl.appendChild(rowEl);
            this.gridCellRefs.push(rowCells);
        }
        this.updateCaret();
        this.updateRowLabels();
        this.updatePasteAction();
        this.attachPasteHandlers();
        this.attachRowLabelHandlers();
        // focus handling: click grid focuses keyboard capture
        this.gridEl.tabIndex = 0;
        this.gridEl.removeEventListener('focus', this.handleGridFocus);
        this.gridEl.removeEventListener('blur', this.handleGridBlur);
        this.gridEl.addEventListener('focus', this.handleGridFocus);
        this.gridEl.addEventListener('blur', this.handleGridBlur);
        // paste event listener for all paste operations (Ctrl+V, right-click, menu, etc.)
        // Remove old listener first to prevent duplicates
        this.gridEl.removeEventListener('paste', this.handlePaste);
        this.gridEl.addEventListener('paste', this.handlePaste);
        safeFocus(this.gridEl);
    }

    updateCaret() {
        // highlight current cell
        this.gridCellRefs.flat().forEach(cell => cell.classList.remove('grid-current'));
        if (this.currentRow < this.gridRows && this.currentCol < this.gridCols) {
            this.gridCellRefs[this.currentRow][this.currentCol].classList.add('grid-current');
        }
    }

    handleKeydown = (e) => {
        if (this.gameOver || this.isAnimating) return;
        // Never process game input while modal is open
        if (document.body.classList.contains('modal-open')) return;
        // accept input anywhere; if user is typing in another field, ignore
        const active = document.activeElement;
        const isTypingInInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
        if (isTypingInInput && active !== this.gridEl) return;
        // Never intercept browser shortcuts (Cmd/Ctrl/Alt combos)
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        const key = e.key.toUpperCase();
        if (/^[0-9A-F]$/.test(key)) {
            if (this.currentCol < this.gridCols) {
                this.setCell(this.currentRow, this.currentCol, key);
                this.currentCol++;
                if (this.currentCol >= this.gridCols) this.currentCol = this.gridCols;
                this.updateCaret();
            }
            e.preventDefault();
        } 
        else if (e.key === 'Backspace') {
            if (this.currentCol > 0) {
                this.currentCol--;
                this.setCell(this.currentRow, this.currentCol, '');
                this.updateCaret();
            }
            e.preventDefault();
        } 
        else if (e.key === 'Enter') {
            this.submitGuess();
            e.preventDefault();
        }
    }

    handlePaste = async (e) => {
        if (this.gameOver || this.isAnimating) return;
        
        // Prevent default paste behavior
        if (e && e.preventDefault) {
            e.preventDefault();
        }
        
        try {
            let text;
            // Try to get text from paste event first, fallback to clipboard API
            if (e && e.clipboardData) {
                text = e.clipboardData.getData('text');
            } else {
                text = await navigator.clipboard.readText();
            }
            
            const hex = (text || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase().slice(0, 6);
            if (!hex) return;
            
            // Fill the current row with the pasted hex
            for (let i = 0; i < this.gridCols; i++) {
                const ch = hex[i] || '';
                this.setCell(this.currentRow, i, ch);
            }
            
            // Update cursor position to end of pasted content
            const lastCol = Math.min(hex.length, this.gridCols);
            this.currentCol = Math.max(0, lastCol);
            this.updateCaret();
            safeFocus(this.gridEl);
        } catch (err) {
            if (typeof window.showToast === 'function') {
                window.showToast('Clipboard access failed');
            }
        }
    }

    handleGridFocus = () => {
        this.gridFocused = true;
    }

    handleGridBlur = () => {
        this.gridFocused = false;
    }

    getShareDateText() {
        const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const fallback = new Date();
        const source = this.mode === 'daily'
            ? this.dailyPuzzleDate
            : fallback.toISOString().split('T')[0];
        const ymdMatch = typeof source === 'string'
            ? source.match(/^(\d{4})-(\d{2})-(\d{2})$/)
            : null;

        if (ymdMatch) {
            const [, year, month, day] = ymdMatch;
            const monthIndex = Number(month) - 1;
            const monthLabel = monthLabels[monthIndex] || monthLabels[fallback.getMonth()];
            return `${monthLabel}/${day}/${year}`;
        }

        const month = monthLabels[fallback.getUTCMonth()];
        const day = String(fallback.getUTCDate()).padStart(2, '0');
        const year = String(fallback.getUTCFullYear());
        return `${month}/${day}/${year}`;
    }

    buildShareResultsText() {
        const modeLabel = this.mode === 'daily' ? 'Daily' : 'Unlimited';
        const dateLabel = this.getShareDateText();
        const attemptsUsed = Math.min(this.guessHistory.length, this.maxAttempts);
        const attemptsLabel = `${attemptsUsed}/${this.maxAttempts} Attempts`;
        const statusToEmoji = {
            correct: '🟩',
            close: '🟨',
            near: '🟧',
            wrong: '⬜'
        };

        const guessLines = this.guessHistory
            .filter((entry) => entry && typeof entry.hex === 'string' && entry.hex.length === 6)
            .map((entry) => this.getStatusesForGuess(entry.hex.toUpperCase())
                .map((status) => statusToEmoji[status] || statusToEmoji.wrong)
                .join(''));

        return `HexGuessr - ${modeLabel}\n${dateLabel}\n${attemptsLabel}\n\n${guessLines.join('\n')}\n\nhttps://hexguessr.com`;
    }

    async copyShareResults() {
        const text = this.buildShareResultsText();

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                try { ta.focus({ preventScroll: true }); } catch { ta.focus(); }
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }

            if (typeof window.showToast === 'function') {
                window.showToast('Game results copied!');
            }
        } catch {
            if (typeof window.showToast === 'function') {
                window.showToast('Clipboard access failed');
            }
        }
    }

    setCell(r, c, ch) {
        const cell = this.gridCellRefs[r][c];

        // Ensure there is a <span class="char"> inside the cell
        let span = cell.querySelector('.char');
        if (!span) {
            span = document.createElement('span');
            span.className = 'char';
            // keep existing text if any
            const existing = cell.textContent || '';
            cell.textContent = '';
            span.textContent = existing;
            cell.appendChild(span);
        }

        const prev = span.textContent || '';
        span.textContent = ch || '';

        if (ch) {
            cell.classList.add('filled');
        } 
        else {
            cell.classList.remove('filled');
        }

        // Pop only when typing/pasting a NEW non-empty char
        if (ch && ch !== prev) {
            triggerPop(cell);
        }
    }

    getCurrentGuess() {
        const chars = [];
        for (let c = 0; c < this.gridCols; c++) {
            chars.push(this.gridCellRefs[this.currentRow][c].textContent || '');
        }
        return chars.join('');
    }

    lockCurrentRow() {
        const rowCells = this.gridCellRefs[this.currentRow];
        rowCells.forEach(cell => cell.parentElement.classList.add('grid-row-locked'));
    }
    
    lockRow(rowIndex) {
        const rowCells = this.gridCellRefs[rowIndex];
        if (rowCells) {
            rowCells.forEach(cell => cell.parentElement.classList.add('grid-row-locked'));
        }
    }
    
    showWaitForRevealNotification() {
        // Show toast notification
        if (typeof window.showToast === 'function') {
            window.showToast('Wait for color reveal to finish!');
        }
        // Shake the current row
        const currentRowEl = this.gridCellRefs[this.currentRow]?.[0]?.parentElement;
        if (currentRowEl) {
            currentRowEl.classList.remove('shake');
            // Force reflow to restart animation
            void currentRowEl.offsetWidth;
            currentRowEl.classList.add('shake');
            setTimeout(() => {
                currentRowEl.classList.remove('shake');
            }, 500);
        }
    }

    clearCurrentRowBuffer() {
        // nothing to clear visually; advance to next row
        this.currentRow++;
        this.currentCol = 0;
        this.updateCaret();
        this.updateRowLabels();
        this.updatePasteAction();
    }

    updateRowLabels() {
        // Hide non-colored labels
        this.rowLabels.forEach((lbl) => {
            if (!lbl.classList.contains('colored')) {
                lbl.classList.remove('visible');
            }
        });
        // Show current row's label
        if (this.currentRow < this.rowLabels.length) {
            const lbl = this.rowLabels[this.currentRow];
            lbl.classList.add('visible');
            // Keep applied guess colors intact; only reset plain active labels.
            if (!lbl.classList.contains('colored')) {
                lbl.style.color = ''; // reset to default
            }
        }
    }

    clearActiveRowIndicators() {
        // Hide caret from any row
        this.gridCellRefs.flat().forEach(cell => cell.classList.remove('grid-current'));
        // Hide only the non-colored "#" labels (keep guessed row labels visible)
        this.rowLabels.forEach((lbl) => {
            if (!lbl.classList.contains('colored')) {
                lbl.classList.remove('visible');
            }
        });
    }
    colorizeRowLabel(rowIndex, hex) {
        if (rowIndex < 0 || rowIndex >= this.rowLabels.length) return;
        const lbl = this.rowLabels[rowIndex];
        lbl.classList.add('visible', 'colored');
        lbl.style.color = `#${hex}`;
    }
    
    updatePasteAction() {
        this.rowActions.forEach((el, idx) => {
            const isCurrentRow = idx === this.currentRow;
            const isPostGameRow = this.postGameActionRow !== null && idx === this.postGameActionRow;
            el.classList.toggle('visible', this.gameOver ? isPostGameRow : isCurrentRow);
        });
    }

    setRowActionMode(rowIndex, mode) {
        const btn = this.pasteButtons[rowIndex];
        const iconUse = this.rowActionIcons[rowIndex];
        if (!btn || !iconUse) return;

        const normalizedMode = mode === 'share' ? 'share' : 'paste';
        this.rowActionModes[rowIndex] = normalizedMode;
        btn.setAttribute('aria-label', normalizedMode === 'share' ? 'Share' : 'Paste');
        iconUse.setAttribute('href', normalizedMode === 'share' ? '#icon-share' : '#icon-paste');
    }

    attachPasteHandlers() {
        this.pasteButtons.forEach((btn, idx) => {
            btn.onclick = async () => {
                if (this.gameOver) {
                    const isShareButton = this.rowActionModes[idx] === 'share';
                    if (idx !== this.postGameActionRow || !isShareButton) return;
                    await this.copyShareResults();
                    return;
                }

                if (this.isAnimating || idx !== this.currentRow || this.rowActionModes[idx] !== 'paste') return;
                await this.handlePaste();
            };
        });
    }

    attachRowLabelHandlers() {
        this.rowLabels.forEach((label, rowIndex) => {
            label.onclick = () => {
                // Only work for rows where a guess has already been made
                // (colorizeRowLabel adds the "colored" class)
                if (!label.classList.contains('colored')) return;

                const rowCells = this.gridCellRefs[rowIndex];
                if (!rowCells) return;

                // Build hex from the row's 6 cells
                const hex = rowCells
                    .map(cell => (cell.textContent || ''))
                    .join('')
                    .replace(/[^0-9A-Fa-f]/g, '')
                    .toUpperCase();

                // Only proceed if it's a full 6-char hex
                if (hex.length !== 6) return;

                // Put it into the main hex output + sync the picker
                this.hexOutputField.value = hex;
                this.updateFromHex(hex);

                // Keep preview + output visible with a top offset (no center jump).
                const controls = this.hexOutputField?.closest('.color-controls') || this.hexOutputField;
                if (controls) {
                    const topPad = 16; // room above preview so it doesn't feel cramped
                    const rect = controls.getBoundingClientRect();
                    const targetY = window.scrollY + rect.top - topPad;
                    window.scrollTo({
                        top: Math.max(0, targetY),
                        behavior: 'smooth'
                    });
                }

                try {
                    this.hexOutputField.focus({ preventScroll: true });
                } catch {
                    this.hexOutputField.focus();
                }
            };
        });
    }

    setupOnScreenKeyboard() {
        this.keyboardEl = document.getElementById('hexKeyboard');
        if (!this.keyboardEl) return;

        // Prevent duplicate handlers across restartGame() calls.
        if (this.onScreenKeyboardClickHandler) {
            this.keyboardEl.removeEventListener('click', this.onScreenKeyboardClickHandler);
        }

        this.onScreenKeyboardClickHandler = (e) => {
            if (this.gameOver || this.isAnimating) return;
            const btn = e.target.closest('.key-btn');
            if (!btn) return;
            const action = btn.dataset.action || '';
            const key = (btn.dataset.key || '').toUpperCase();
            
            if (action === 'enter') {
                this.submitGuess();
                return;
            }
            if (action === 'backspace') {
                   if (this.currentCol > 0) {
                    this.currentCol--;
                    this.setCell(this.currentRow, this.currentCol, '');
                    this.updateCaret();
                }
                return;
            }
            if (/^[0-9A-F]$/.test(key)) {
                if (this.currentCol < this.gridCols) {
                    this.setCell(this.currentRow, this.currentCol, key);
                    this.currentCol = Math.min(this.currentCol + 1, this.gridCols);
                    this.updateCaret();
                }
            }
        };

        this.keyboardEl.addEventListener('click', this.onScreenKeyboardClickHandler);
    }

    setupEventListeners() {
        this.colorDisplay.addEventListener('click', () => this.showColor());
                
        // Custom color picker event listeners
        this.setupColorPickerListeners();
    }
            
    setupColorPickerListeners() {
        let isDraggingCanvas = false;
        let isDraggingHue = false;

        // Touch “focus” state: user must tap once to arm, then drag on second gesture
        let touchCanvasArmed = false;
        let touchHueArmed = false;

        // Tap vs drag detection
        const TAP_THRESHOLD = 10; // px

        let canvasStartX = 0, canvasStartY = 0;
        let canvasPotentialTap = false;

        let hueStartY = 0;
        let huePotentialTap = false;

        const startDrag = () => {
            document.body.classList.add('color-dragging');
        };
        const endDrag = () => {
            document.body.classList.remove('color-dragging');
        };
        const clearTouchFocus = () => {
            touchCanvasArmed = false;
            touchHueArmed = false;
            this.colorCanvas.classList.remove('touch-active');
            this.hueSlider.classList.remove('touch-active');
        };

        // Detect touch-capable devices
        const isTouchDevice =
            ('ontouchstart' in window) ||
            (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
            (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0);

        // ----- MOUSE: desktop / non-touch only -----
        if (!isTouchDevice) {
            this.colorCanvas.addEventListener('mousedown', (e) => {
                isDraggingCanvas = true;
                startDrag();
                this.updateCanvasPosition(e);
            });

            this.hueSlider.addEventListener('mousedown', (e) => {
                isDraggingHue = true;
                startDrag();
                this.updateHuePosition(e);
            });

            document.addEventListener('mousemove', (e) => {
                if (isDraggingCanvas) {
                    this.updateCanvasPosition(e);
                }
                if (isDraggingHue) {
                    this.updateHuePosition(e);
                }
            });

            document.addEventListener('mouseup', () => {
                if (isDraggingCanvas || isDraggingHue) {
                    isDraggingCanvas = false;
                    isDraggingHue = false;
                    endDrag();
                }
            });
        }

        // ----- TOUCH: tap to arm, second gesture to drag -----

        // Canvas touchstart
        this.colorCanvas.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];

            if (!touchCanvasArmed) {
                // First ever interaction: treat this gesture as a candidate "tap"
                canvasPotentialTap = true;
                canvasStartX = touch.clientX;
                canvasStartY = touch.clientY;
                // IMPORTANT: no preventDefault here → scroll still works
                return;
            }

            // Already armed → this gesture is for dragging
            canvasPotentialTap = false;
            isDraggingCanvas = true;
            startDrag();
            e.preventDefault(); // keep drag smooth
            this.updateCanvasPosition(e);
        }, { passive: false });

        // Hue slider touchstart
        this.hueSlider.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];

            if (!touchHueArmed) {
                huePotentialTap = true;
                hueStartY = touch.clientY;
                return;
            }

            // Already armed → drag
            huePotentialTap = false;
            isDraggingHue = true;
            startDrag();
            e.preventDefault();
            this.updateHuePosition(e);
        }, { passive: false });

        // Element-level touchmove for tap vs drag detection
        this.colorCanvas.addEventListener('touchmove', (e) => {
            if (!canvasPotentialTap) return;
            const touch = e.touches[0];
            const dx = touch.clientX - canvasStartX;
            const dy = touch.clientY - canvasStartY;
            if (Math.hypot(dx, dy) > TAP_THRESHOLD) {
                canvasPotentialTap = false; // no longer a tap; user is dragging/scrolling
            }
            // do NOT preventDefault here; scrolling should continue
        }, { passive: true });

        this.hueSlider.addEventListener('touchmove', (e) => {
            if (!huePotentialTap) return;
            const touch = e.touches[0];
            const dy = touch.clientY - hueStartY;
            if (Math.abs(dy) > TAP_THRESHOLD) {
                huePotentialTap = false;
            }
        }, { passive: true });

        // Dragging with touch (only when actually dragging)
        document.addEventListener('touchmove', (e) => {
            if (!isDraggingCanvas && !isDraggingHue) return;

            e.preventDefault(); // only when dragging
            if (isDraggingCanvas) this.updateCanvasPosition(e);
            if (isDraggingHue) this.updateHuePosition(e);
        }, { passive: false });

        document.addEventListener('touchend', (e) => {
            // End drag if we were dragging
            if (isDraggingCanvas || isDraggingHue) {
                isDraggingCanvas = false;
                isDraggingHue = false;
                endDrag();
            }

            // Handle "tap" completion for canvas
            if (!touchCanvasArmed && canvasPotentialTap) {
                touchCanvasArmed = true;
                touchHueArmed = false;
                this.colorCanvas.classList.add('touch-active');
                this.hueSlider.classList.remove('touch-active');
            }

            // Handle "tap" completion for hue slider
            if (!touchHueArmed && huePotentialTap) {
                touchHueArmed = true;
                touchCanvasArmed = false;
                this.hueSlider.classList.add('touch-active');
                this.colorCanvas.classList.remove('touch-active');
            }

            // Reset potentialTap flags after gesture ends
            canvasPotentialTap = false;
            huePotentialTap = false;
        });

        document.addEventListener('touchcancel', () => {
            if (isDraggingCanvas || isDraggingHue) {
                isDraggingCanvas = false;
                isDraggingHue = false;
                endDrag();
            }
            canvasPotentialTap = false;
            huePotentialTap = false;
        });

        // Tapping anywhere outside picker clears the “armed” state + outline
        document.addEventListener('touchstart', (e) => {
            const t = e.target;
            if (!this.colorCanvas.contains(t) && !this.hueSlider.contains(t)) {
                clearTouchFocus();
            }
        }, { passive: true });

        // Any page scroll disarms the picker (user has "moved on")
        window.addEventListener('scroll', () => {
            clearTouchFocus();
        }, { passive: true });

        // ----- Hex output restrictions -----
        this.hexOutputField.addEventListener('beforeinput', (e) => {
            if (e.isComposing) return;
            if (!e.inputType || !e.inputType.startsWith('insert')) return;

            const input = e.target;
            const current = (input.value || '').replace(/[^0-9A-Fa-f]/g, '');
            const start = input.selectionStart ?? current.length;
            const end = input.selectionEnd ?? current.length;
            const hasSelection = end > start;

            // At max length, block insertion unless user is replacing selected text.
            if (current.length >= 6 && !hasSelection) {
                e.preventDefault();
            }
        });

        this.hexOutputField.addEventListener("keydown", e => {
            // Allow shortcuts
            if (e.metaKey || e.ctrlKey || e.altKey) return;

            // Close mobile keyboard on Enter
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                this.hexOutputField.blur();
                return;
            }

            // Only allow 0–9 / A–F
            if (e.key.length === 1 && !/^[0-9A-Fa-f]$/.test(e.key)) {
                e.preventDefault();
                return;
            }

            // At max length, don't allow new chars unless replacing a selection.
            if (/^[0-9A-Fa-f]$/.test(e.key)) {
                const start = this.hexOutputField.selectionStart ?? 0;
                const end = this.hexOutputField.selectionEnd ?? 0;
                const hasSelection = end > start;
                if (this.hexOutputField.value.length >= 6 && !hasSelection) {
                    e.preventDefault();
                }
            }
        });

        this.hexOutputField.addEventListener('input', (e) => {
            const input = e.target;
            const pos = input.selectionStart;
            const filtered = input.value
                .replace(/[^0-9A-Fa-f]/g, '')
                .toUpperCase()
                .slice(0, 6);
            input.value = filtered;
            const caretPos = Math.min(pos ?? filtered.length, filtered.length);
            input.setSelectionRange(caretPos, caretPos);

            if (filtered.length === 6) {
                this.updateFromHex(filtered);
            }
        });

        this.copyBtn.addEventListener('click', async () => {
            const hexValue = (this.hexOutputField.value || '')
                .toUpperCase()
                .replace(/[^0-9A-F]/g, '')
                .slice(0, 6);

            if (!hexValue) {
                if (typeof window.showToast === 'function') window.showToast('Nothing to copy');
                return;
            }

            const text = hexValue.startsWith('#') ? hexValue : ('#' + hexValue);

            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    try { ta.focus({ preventScroll: true }); } catch { ta.focus(); }
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                }
                if (typeof window.showToast === 'function') window.showToast('Copied!');
            } catch {
                if (typeof window.showToast === 'function') window.showToast('Press ⌘C / Ctrl+C');
            }
        });

        // Initialize color picker
        this.currentHue = 0;
        this.currentSaturation = 1;
        this.currentValue = 1;
        this.updateColorPicker();
    }
        
    updateCanvasPosition(e) {
        const rect = this.colorCanvas.getBoundingClientRect();

        // Support both mouse and touch events
        let clientX, clientY;
        if (e.touches && e.touches.length) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        const x = Math.max(0, Math.min(rect.width,  clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, clientY - rect.top));

        this.canvasCursor.style.left = x + 'px';
        this.canvasCursor.style.top  = y + 'px';

        // Calculate saturation and brightness (value)
        this.currentSaturation = x / rect.width;
        this.currentValue      = 1 - (y / rect.height);

        this.updateColorFromHSV();
    }

    updateHuePosition(e) {
        const rect = this.hueSlider.getBoundingClientRect();

        // Support both mouse and touch events
        let clientY;
        if (e.touches && e.touches.length) {
            clientY = e.touches[0].clientY;
        } else {
            clientY = e.clientY;
        }

        const y = Math.max(0, Math.min(rect.height, clientY - rect.top));

        this.hueCursor.style.top = y + 'px';

        // Calculate hue (0–360)
        this.currentHue = (y / rect.height) * 360;

        // Update canvas background
        const hueColor = `hsl(${this.currentHue}, 100%, 50%)`;
        this.colorCanvas.style.background =
            `linear-gradient(to right, #fff, ${hueColor})`;

        this.updateColorFromHSV();
    }
            
    updateColorFromHSV() {
        // Convert HSV to RGB
        const h = this.currentHue / 360;
        const s = this.currentSaturation;
        const v = this.currentValue;
                
        const c = v * s;
        const x = c * (1 - Math.abs((h * 6) % 2 - 1));
        const m = v - c;
                
        let r, g, b;
        if (h < 1/6) {
            r = c; g = x; b = 0;
        } else if (h < 2/6) {
            r = x; g = c; b = 0;
        } else if (h < 3/6) {
            r = 0; g = c; b = x;
        } else if (h < 4/6) {
            r = 0; g = x; b = c;
        } else if (h < 5/6) {
            r = x; g = 0; b = c;
        } else {
            r = c; g = 0; b = x;
        }
                
        r = (r + m);
        g = (g + m);
        b = (b + m);
                
        // Convert to 0-255 range
        r = Math.round(r * 255);
        g = Math.round(g * 255);
        b = Math.round(b * 255);
                
        // Convert to hex
        const hex = ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
                
        // Update UI
        this.colorPreview.style.backgroundColor = `#${hex}`;
        this.hexOutputField.value = hex;
    }
            
    updateFromHex(hex) {
        // Convert hex to RGB
        const r = parseInt(hex.substr(0, 2), 16) / 255;
        const g = parseInt(hex.substr(2, 2), 16) / 255;
        const b = parseInt(hex.substr(4, 2), 16) / 255;

        // Convert RGB to HSV
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;

        let h, s, v = max;

        if (delta === 0) {
            h = 0;
            s = 0;
        } 
        else {
            s = delta / max;

            switch (max) {
                case r: h = (g - b) / delta + (g < b ? 6 : 0); break;
                case g: h = (b - r) / delta + 2; break;
                case b: h = (r - g) / delta + 4; break;
            }
            h /= 6;
        }

        // Update internal state
        this.currentHue        = h * 360;
        this.currentSaturation = s;
        this.currentValue      = v;

        // Re-position cursors & canvas based on state.
        // If layout is transient (0x0), schedule a short retry window.
        if (!this.syncCursorsFromState()) {
            this.requestPickerCursorSync(6);
        }

        // Update preview + hex output field
        this.colorPreview.style.backgroundColor = `#${hex}`;
        this.hexOutputField.value = hex;
    }

    handleResize = () => {
        // Recompute after layout settles (mobile viewport/UI can lag one frame)
        this.requestPickerCursorSync(4);
    };

    syncCursorsFromState() {
        const sliderHeight = this.hueSlider?.clientHeight || 0;
        const canvasWidth  = this.colorCanvas?.clientWidth || 0;
        const canvasHeight = this.colorCanvas?.clientHeight || 0;

        // Bail out when layout isn't ready yet (first-load race on some mobiles).
        if (sliderHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
            return false;
        }

        const hue = Number.isFinite(this.currentHue) ? this.currentHue : 0;
        const saturation = Number.isFinite(this.currentSaturation) ? this.currentSaturation : 0;
        const value = Number.isFinite(this.currentValue) ? this.currentValue : 0;

        const hueClamped = Math.max(0, Math.min(360, hue));
        const satClamped = Math.max(0, Math.min(1, saturation));
        const valClamped = Math.max(0, Math.min(1, value));

        // Hue slider cursor
        const huePos = (hueClamped / 360) * sliderHeight;
        this.hueCursor.style.top = huePos + 'px';

        // Canvas cursor
        const canvasX = satClamped * canvasWidth;
        const canvasY = (1 - valClamped) * canvasHeight;

        this.canvasCursor.style.left = canvasX + 'px';
        this.canvasCursor.style.top  = canvasY + 'px';

        // Canvas background for the current hue
        const hueColor = `hsl(${hueClamped}, 100%, 50%)`;
        this.colorCanvas.style.background =
            `linear-gradient(to right, #fff, ${hueColor})`;

        return true;
    }

    requestPickerCursorSync(maxFrames = 6) {
        if (this._pickerSyncRaf) {
            cancelAnimationFrame(this._pickerSyncRaf);
            this._pickerSyncRaf = null;
        }

        let remaining = Math.max(1, maxFrames | 0);
        const syncLoop = () => {
            const synced = this.syncCursorsFromState();
            if (synced || remaining <= 1) {
                this._pickerSyncRaf = null;
                return;
            }
            remaining -= 1;
            this._pickerSyncRaf = requestAnimationFrame(syncLoop);
        };

        this._pickerSyncRaf = requestAnimationFrame(syncLoop);
    }

    setupPickerLayoutSync() {
        // Guard against partial/missing picker DOM (defensive for future markup edits).
        if (!this.colorCanvas || !this.hueSlider || !this.canvasCursor || !this.hueCursor) return;

        // Initial post-construct retries to catch first-paint sizing on mobile.
        this.requestPickerCursorSync(10);

        // Ensure a sync after full page load (images/CSS/layout finalization).
        window.addEventListener('load', () => this.requestPickerCursorSync(8), { once: true });

        // Sync again after web fonts settle (can affect first render geometry).
        if (document.fonts?.ready) {
            document.fonts.ready
                .then(() => this.requestPickerCursorSync(8))
                .catch(() => {});
        }

        // Track size changes of the picker itself.
        if (typeof ResizeObserver !== 'undefined') {
            this._pickerResizeObserver = new ResizeObserver(() => this.requestPickerCursorSync(3));
            this._pickerResizeObserver.observe(this.colorCanvas);
            this._pickerResizeObserver.observe(this.hueSlider);
        }

        // Mobile browser chrome/keyboard often changes visual viewport without stable window resize timing.
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => this.requestPickerCursorSync(4), { passive: true });
        }
        window.addEventListener('orientationchange', () => this.requestPickerCursorSync(8), { passive: true });
    }


    generateRandomColor() {
        return Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0').toUpperCase();
    }

    showColor() {
        // Prevent reveal during row-reveal animation/settle window so attempt timing stays correct.
        if (this.colorVisible || this.gameOver || this.hasRevealedThisAttempt || this.isAnimating) return;
                
        this.colorVisible = true;
        this.hasRevealedThisAttempt = true;
        this.colorDisplay.style.background = `#${this.targetColor}`;
        this.colorDisplay.classList.remove('hidden');
        this.colorDisplay.textContent = '';
        this.colorDisplay.classList.add('disabled');
                
        // Calculate duration: increases with each attempt
        const duration = this.baseDuration + (this.currentAttempt - 1) * 500;
                
        this.startTimer(duration);
        
        // Save state immediately after revealing color
        if (this.mode === 'daily') {
            this.saveDailyGameState();
        }
                
        setTimeout(() => {
            if (!this.gameOver) {
                this.colorDisplay.classList.add('hidden');
                this.colorDisplay.textContent = 'Submit a guess to reveal again!';
                this.colorVisible = false;
                // Keep timer bar empty after color is hidden
                this.timerFill.style.transition = '';
                this.timerFill.style.transform = 'scaleX(0)';
                
                // Save state after timer expires
                if (this.mode === 'daily') {
                    this.saveDailyGameState();
                }
            }
        }, duration);
    }

    startTimer(duration) {
        this.timerFill.style.transition = `transform ${duration}ms linear`;
        requestAnimationFrame(() => {
            this.timerFill.style.transform = 'scaleX(0)';
        });
    }

    submitGuess() {
        if (this.gameOver || this.isAnimating) return;
        // Block submission if modal is open
        if (document.body.classList.contains('modal-open')) return;
        // Do not allow guesses while the reveal timer is active
        if (this.colorVisible) {
            this.showWaitForRevealNotification();
            return;
        }
        const guess = this.getCurrentGuess();
        
        // Validation with toast notification and shake animation
        if (guess.length < 6) {
            // Show toast notification
            if (typeof window.showToast === 'function') {
                window.showToast('Hex code is too short');
            }
            // Shake the current row
            const currentRowEl = this.gridCellRefs[this.currentRow][0]?.parentElement;
            if (currentRowEl) {
                currentRowEl.classList.remove('shake');
                // Force reflow to restart animation
                void currentRowEl.offsetWidth;
                currentRowEl.classList.add('shake');
                // Remove shake class after animation completes
                setTimeout(() => {
                    currentRowEl.classList.remove('shake');
                }, 500);
            }
            return;
        }
        
        if (!/^[0-9A-F]{6}$/.test(guess)) {
            if (typeof window.showToast === 'function') {
                window.showToast('Invalid characters in hex code');
            }
            // Shake the current row
            const currentRowEl = this.gridCellRefs[this.currentRow][0]?.parentElement;
            if (currentRowEl) {
                currentRowEl.classList.remove('shake');
                void currentRowEl.offsetWidth;
                currentRowEl.classList.add('shake');
                setTimeout(() => {
                    currentRowEl.classList.remove('shake');
                }, 500);
            }
            return;
        }
        
        // Calculate and store color error for this guess (after validation passes)
        const colorError = this.calculateColorError(guess, this.targetColor);
        this.guessHistory.push({
            hex: guess,
            colorError: colorError
        });
        const submittedRow = this.currentRow;

        // lock the row UI
        this.lockCurrentRow();
        
        // Set animation flag to prevent input during animation
        this.isAnimating = true;
                
        // Process the guess animation first
        this.processGuess(guess);

        // Persist submitted guess immediately so leaving/reloading during the
        // reveal-settle delay does not drop progress in daily mode.
        if (this.mode === 'daily') {
            this.saveDailyGameState();
        }
        
        // Reset reveal ability for next attempt AFTER animation completes
        // Animation timing: last cell starts at 5*140ms=700ms, animation duration is 360ms = 1060ms total.
        // Use a small buffer so row indicators/paste advance only after reveal settles.
        const rowRevealSettleDelay = 1100;
        setTimeout(() => {
            this.isAnimating = false; // Allow input again
            if (!this.gameOver) {
                this.hasRevealedThisAttempt = false;
                this.colorDisplay.classList.remove('disabled');
                if (!this.colorVisible) {
                    this.colorDisplay.textContent = 'Click to reveal color!';
                    // Refill timer at the same moment the reveal prompt resets
                    this.timerFill.style.transition = '';
                    this.timerFill.style.transform = 'scaleX(1)';
                }
                // Progress attempt/UI only after reveal animation settles so
                // there is no early cue before row transition.
                this.currentAttempt++;
                if (this.currentAttemptSpan) {
                    this.currentAttemptSpan.textContent = this.currentAttempt;
                }
                this.clearCurrentRowBuffer();
                // Persist the reset reveal-state for daily mode so reload doesn't
                // incorrectly show "Submit a guess to reveal again!".
                if (this.mode === 'daily') {
                    this.saveDailyGameState();
                }
            }
        }, rowRevealSettleDelay); // Wait for reveal animation to complete before row transition
        this.colorizeRowLabel(submittedRow, guess);
        
        if (guess === this.targetColor) {
            this.endGame(true, submittedRow, rowRevealSettleDelay);
        } 
        else if (this.currentAttempt >= this.maxAttempts) {
            this.endGame(false, submittedRow, rowRevealSettleDelay);
        } 
    }

    processGuess(guess) {
        const rowCells = this.gridCellRefs[this.currentRow];

        // 1) Compute statuses up front, but don't apply yet
        const statuses = this.getStatusesForGuess(guess);

        // 2) Ensure each cell's character is wrapped for crisp control (doesn't change visuals)
        rowCells.forEach((cell) => {
            const ch = cell.textContent || '';
            if (!cell.querySelector('.char')) {
                cell.textContent = '';
                const span = document.createElement('span');
                span.className = 'char';
                span.textContent = ch;
                cell.appendChild(span);
            }
        });

        // 3) Staggered jump + mid-air color swap
        const perCellDelay = 140;    // ms between tiles (retro snappiness)
        const animDuration = 360;    // must match CSS jump-8bit duration
        const swapAt       = Math.floor(animDuration * 0.5); // “coming down”

        rowCells.forEach((cell, i) => {
            // clean previous state classes
            cell.classList.remove('correct', 'close', 'near', 'wrong', 'reveal-jump', 'land-pop');

            setTimeout(() => {
                // start jump
                cell.classList.add('reveal-jump');

                // halfway down: apply status color
                setTimeout(() => {
                    cell.classList.remove('correct', 'close', 'near', 'wrong'); // safety
                    cell.classList.add(statuses[i]);
                }, swapAt);

                // end: clear jump, add a tiny landing pop (optional)
                setTimeout(() => {
                    cell.classList.remove('reveal-jump');
                    cell.classList.add('land-pop');
                    setTimeout(() => cell.classList.remove('land-pop'), 140); // clean up
                }, animDuration);
            }, i * perCellDelay);
        });
    }

    getDigitDistance(guessChar, targetChar) {
        const guessValue = parseInt(guessChar, 16);
        const targetValue = parseInt(targetChar, 16);
        return Math.abs(guessValue - targetValue);
    }

    getStatusesForGuess(guess) {
        const statuses = [];
        for (let i = 0; i < 6; i++) {
            const distance = this.getDigitDistance(guess[i], this.targetColor[i]);
            if (distance === 0) {
                statuses.push('correct');
            } else if (distance <= 1) {
                statuses.push('close');
            } else if (distance <= 3) {
                statuses.push('near');
            } else {
                statuses.push('wrong');
            }
        }
        return statuses;
    }

    playWinGridSweep() {
        const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const perColumnDelay = prefersReducedMotion ? 0 : 105;
        const holdDuration = prefersReducedMotion ? 150 : 450;

        for (let col = 0; col < this.gridCols; col++) {
            setTimeout(() => {
                for (let row = 0; row < this.maxAttempts; row++) {
                    const cell = this.gridCellRefs[row]?.[col];
                    if (!cell) continue;

                    cell.style.setProperty('--win-sweep-color', `#${this.targetColor}`);
                    cell.classList.add('win-sweep');

                    setTimeout(() => {
                        cell.classList.remove('win-sweep');
                        cell.style.removeProperty('--win-sweep-color');
                    }, holdDuration);
                }
            }, col * perColumnDelay);
        }

        const lastColumnDelay = (this.gridCols - 1) * perColumnDelay;
        return lastColumnDelay + holdDuration;
    }

    endGame(won, finalRowIndex = null, postSubmitDelay = 1100) {
        this.gameOver = true;
        if (Number.isInteger(finalRowIndex)) {
            this.postGameActionRow = Math.max(0, Math.min(this.gridRows - 1, finalRowIndex));
        } else if (this.guessHistory.length > 0) {
            this.postGameActionRow = Math.max(0, Math.min(this.gridRows - 1, this.guessHistory.length - 1));
        } else {
            this.postGameActionRow = null;
        }

        if (this.postGameActionRow !== null) {
            this.setRowActionMode(this.postGameActionRow, 'paste');
        }

        this.clearActiveRowIndicators();
        // Keep row action on the submitted row, then swap to share after end animations.
        this.updatePasteAction();
        
        // Wait for submitted row reveal animation completion before end-game UI swap.
        const animationDelay = Math.max(0, postSubmitDelay | 0);
        
        // Delay color reveal until animations complete
        setTimeout(() => {
            this.colorDisplay.style.background = `#${this.targetColor}`;
            this.colorDisplay.classList.remove('hidden', 'disabled'); // Remove disabled to prevent gray text
            this.colorDisplay.textContent = `#${this.targetColor}`;
            this.colorDisplay.classList.add('game-ended');

            // Empty timer when end-game UI is shown (same moment share appears).
            this.timerFill.style.transition = '';
            this.timerFill.style.transform = 'scaleX(0)';

            if (this.postGameActionRow !== null) {
                this.setRowActionMode(this.postGameActionRow, 'share');
                this.updatePasteAction();
            }

            if (won) {
                this.playWinGridSweep();
            }

            if (this.mode === 'daily') {
                this.saveDailyGameState();
            }
            
            // Show random win/loss message
            if (typeof window.showToast === 'function') {
                const message = this.getRandomGameMessage(won, this.currentAttempt);
                window.showToast(message, 3000);
            }
            
            // Show stats modal after a short delay
            const autoChannel = 'statsEndgameAuto';
            autoPopupBypassState[autoChannel].pending = true;
            setTimeout(() => {
                autoPopupBypassState[autoChannel].pending = false;
                if (shouldSuppressAutoPopup(autoChannel)) return;
                if (document.body.classList.contains('modal-open')) return; // Don't auto-show if another modal is open
                if (typeof window.showStatsModal === 'function') {
                    // In daily mode, pass true to show timer instead of play button
                    const isDailyCompleted = this.mode === 'daily';
                    window.showStatsModal(isDailyCompleted);
                }
            }, 2500); // 2.5 second delay to see color and toast
        }, animationDelay);
        
        // Update statistics
        this.updateGameStats(won);
        
        // Save daily completion and final state if in daily mode
        if (this.mode === 'daily') {
            this.saveDailyCompletion(won);
            this.saveDailyGameState(); // Save final state with completed grid
        }
    }

    getRandomGameMessage(won, attempts) {
        if (won) {
            const winMessages = [
                'Genius!',
                'Magnificent!',
                'Impressive!',
                'Splendid!',
                'Great job!',
                'Well done!',
                'Perfect!',
                'Brilliant!',
                'Outstanding!',
                'Excellent!',
                'Incredible!'
            ];
            
            // Special messages for attempts
            if (attempts === 1) return 'Be honest. Did you cheat?';
            if (attempts === 2) return 'Are you a wizard!?';
            if (attempts === 5) return 'Phew! Close one!';
            
            return winMessages[Math.floor(Math.random() * winMessages.length)];
        } else {
            const lossMessages = [
                'Better luck next time!',
                'So close!',
                'Nice try!',
                "Don't give up!",
                'Almost!',
                'Practice makes perfect!',
                'Keep at it!',
                "You'll get it next time!"
            ];
            return lossMessages[Math.floor(Math.random() * lossMessages.length)];
        }
    }

    updateGameStats(won) {
        const storageKey = `gameStats_${this.mode}`;
        const savedStats = localStorage.getItem(storageKey);
        let stats = savedStats ? JSON.parse(savedStats) : {
            gamesPlayed: 0,
            gamesWon: 0,
            gamesLost: 0,
            currentStreak: 0,
            maxStreak: 0,
            totalGuessesAllGames: 0,
            totalColorErrorAllGuesses: 0,
            totalErrorReduction: 0
        };

        stats.gamesPlayed++;
        
        if (won) {
            stats.gamesWon++;
            stats.currentStreak++;
            stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
        } else {
            stats.gamesLost++;
            stats.currentStreak = 0;
        }

        // Process all guesses from this game
        stats.totalGuessesAllGames += this.guessHistory.length;
        
        // Add up color error for every guess
        this.guessHistory.forEach(guess => {
            stats.totalColorErrorAllGuesses += guess.colorError;
        });

        // Calculate error reduction (improvement) between consecutive guesses
        for (let i = 1; i < this.guessHistory.length; i++) {
            const previousError = this.guessHistory[i - 1].colorError;
            const currentError = this.guessHistory[i].colorError;
            const reduction = previousError - currentError; // Positive = improvement, negative = getting worse
            stats.totalErrorReduction += reduction; // Allow negative values
        }

        localStorage.setItem(storageKey, JSON.stringify(stats));
    }

    calculateColorError(guess, target) {
        // Simple RGB distance calculation
        const r1 = parseInt(guess.substr(0, 2), 16);
        const g1 = parseInt(guess.substr(2, 2), 16);
        const b1 = parseInt(guess.substr(4, 2), 16);
        
        const r2 = parseInt(target.substr(0, 2), 16);
        const g2 = parseInt(target.substr(2, 2), 16);
        const b2 = parseInt(target.substr(4, 2), 16);
        
        return Math.sqrt(
            Math.pow(r2 - r1, 2) +
            Math.pow(g2 - g1, 2) +
            Math.pow(b2 - b1, 2)
        );
    }

    updateColorPicker() {
        // Initialize with default color
        this.updateFromHex('FF5733');
    }

    restartGame() {
        // In daily mode, don't allow restart if already completed today
        if (this.mode === 'daily' && this.dailyAlreadyCompleted) {
            return; // Already completed today, can't play again
        }
        
        // In unlimited mode, pick a new color
        if (this.mode === 'unlimited') {
            this.targetColor = this.generateRandomColor();
        }
        this.currentAttempt = 1;
        this.gameOver = false;
        this.colorVisible = false;
        this.hasRevealedThisAttempt = false;
        this.isAnimating = false; // Reset animation flag
        this.guessHistory = []; // Reset guess history for new game
        this.postGameActionRow = null;
                
        this.colorDisplay.classList.add('hidden');
        this.colorDisplay.classList.remove('disabled');
        this.colorDisplay.textContent = 'Click to reveal color!';
        if (this.currentAttemptSpan) {
            this.currentAttemptSpan.textContent = '1';
        }
        this.guessesContainer.innerHTML = '';
        this.colorDisplay.classList.remove('game-ended');
                
        // Rebuild grid
        this.buildGrid();
        this.updateRowLabels();
        this.updatePasteAction();
        this.setupOnScreenKeyboard();
                
        // Reset timer bar to full for new game
        this.timerFill.style.transition = '';
        this.timerFill.style.transform = 'scaleX(1)';
                
        // Initialize timer text for new game
    }

    checkDailyCompletion() {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const saved = localStorage.getItem('dailyCompletion');
        
        if (!saved) return { completed: false };
        
        try {
            const data = JSON.parse(saved);
            return {
                completed: data.date === today,
                won: data.won || false
            };
        } catch (e) {
            return { completed: false };
        }
    }

    saveDailyCompletion(won) {
        const puzzleDate = this.dailyPuzzleDate || new Date().toISOString().split('T')[0];
        localStorage.setItem('dailyCompletion', JSON.stringify({
            date: puzzleDate,
            won: won
        }));
    }
    
    saveDailyGameState() {
        if (this.mode !== 'daily') return;
        
        const puzzleDate = this.dailyPuzzleDate || new Date().toISOString().split('T')[0];
        const gameState = {
            date: puzzleDate,
            puzzleDate: puzzleDate,
            targetColor: this.targetColor,
            currentAttempt: this.currentAttempt,
            currentRow: this.currentRow,
            currentCol: this.currentCol,
            gameOver: this.gameOver,
            colorVisible: this.colorVisible,
            hasRevealedThisAttempt: this.isAnimating ? false : this.hasRevealedThisAttempt,
            guessHistory: this.guessHistory,
            postGameActionRow: this.postGameActionRow,
            gridState: [] // Store the visual grid state
        };
        
        // Save grid state (all rows)
        for (let row = 0; row < this.maxAttempts; row++) {
            const rowState = [];
            const guessEntry = this.guessHistory[row];
            const isSubmittedRow = !!(guessEntry && guessEntry.hex && guessEntry.hex.length === 6);
            const rowStatuses = isSubmittedRow ? this.getStatusesForGuess(guessEntry.hex) : null;
            for (let col = 0; col < 6; col++) {
                const cell = this.gridCellRefs[row]?.[col];
                if (cell) {
                    const savedClass = rowStatuses ? `grid-cell ${rowStatuses[col]}` : 'grid-cell';
                    rowState.push({
                        text: isSubmittedRow ? cell.textContent : '',
                        class: savedClass
                    });
                }
            }
            gameState.gridState.push(rowState);
        }
        
        localStorage.setItem('dailyGameState', JSON.stringify(gameState));
    }
    
    loadDailyGameState() {
        if (this.mode !== 'daily') return;
        
        const saved = localStorage.getItem('dailyGameState');
        if (!saved) return;
        
        try {
            const gameState = JSON.parse(saved);
            const today = new Date().toISOString().split('T')[0];
            const savedPuzzleDate = gameState.puzzleDate || gameState.date;
            
            // Only restore if it's today's game
            if (savedPuzzleDate !== today) {
                localStorage.removeItem('dailyGameState');
                return;
            }
            
            // Restore game state
            this.dailyPuzzleDate = savedPuzzleDate;
            this.targetColor = gameState.targetColor;
            const rawAttempt = Number(gameState.currentAttempt);
            const safeAttempt = Number.isFinite(rawAttempt) ? Math.trunc(rawAttempt) : 1;
            this.currentAttempt = Math.max(1, Math.min(this.maxAttempts, safeAttempt));

            const rawRow = gameState.currentRow !== undefined ? Number(gameState.currentRow) : (this.currentAttempt - 1);
            const safeRow = Number.isFinite(rawRow) ? Math.trunc(rawRow) : (this.currentAttempt - 1);
            this.currentRow = Math.max(0, Math.min(this.gridRows - 1, safeRow));

            const rawCol = gameState.currentCol !== undefined ? Number(gameState.currentCol) : 0;
            const safeCol = Number.isFinite(rawCol) ? Math.trunc(rawCol) : 0;
            this.currentCol = Math.max(0, Math.min(this.gridCols, safeCol));
            this.gameOver = gameState.gameOver;
            this.colorVisible = gameState.colorVisible || false;
            this.hasRevealedThisAttempt = gameState.hasRevealedThisAttempt || false;
            this.guessHistory = (gameState.guessHistory || []).slice(0, this.maxAttempts);
            this.postGameActionRow = Number.isInteger(gameState.postGameActionRow)
                ? Math.max(0, Math.min(this.gridRows - 1, gameState.postGameActionRow))
                : null;

            // Defensive normalization: derive active position from submitted guesses.
            // This prevents stale saved attempt/cursor values from breaking end-game flow.
            if (!this.gameOver) {
                this.currentAttempt = Math.min(this.maxAttempts, this.guessHistory.length + 1);
                this.currentRow = Math.min(this.gridRows - 1, this.guessHistory.length);
                this.currentCol = 0;
                this.postGameActionRow = null;
            }
            
            // Restore grid visual state
            if (Array.isArray(gameState.gridState)) {
                const maxRowsToRestore = Math.min(this.gridRows, gameState.gridState.length);
                for (let row = 0; row < maxRowsToRestore; row++) {
                    const rowState = Array.isArray(gameState.gridState[row]) ? gameState.gridState[row] : [];
                    let hasContent = false;
                    
                    const maxColsToRestore = Math.min(this.gridCols, rowState.length);
                    for (let col = 0; col < maxColsToRestore; col++) {
                        const cell = this.gridCellRefs[row]?.[col];
                        const cellState = rowState[col];
                        if (cell && cellState) {
                            cell.textContent = cellState.text;
                            // Restore class but remove animation classes to prevent glitch
                            const cleanClass = cellState.class
                                .replace(/\b(reveal-jump|land-pop)\b/g, '')
                                .trim();
                            cell.className = cleanClass;
                            if (cellState.text) hasContent = true;
                        }
                    }
                    
                    // Lock completed rows (rows before current row)
                    if (hasContent && row < this.currentRow) {
                        this.lockRow(row);
                    }
                }
            }
            
            // Restore row labels with colors
            for (let i = 0; i < this.guessHistory.length; i++) {
                const guess = this.guessHistory[i];
                if (guess && guess.hex) {
                    this.colorizeRowLabel(i, guess.hex);
                }
            }

            // Recompute caret column from actual active-row content so stale
            // saved cursor positions don't survive when unsubmitted text is not persisted.
            if (!this.gameOver && this.currentRow >= 0 && this.currentRow < this.gridRows) {
                const activeRowCells = this.gridCellRefs[this.currentRow] || [];
                let nextCol = 0;
                while (nextCol < this.gridCols && (activeRowCells[nextCol]?.textContent || '')) {
                    nextCol++;
                }
                this.currentCol = Math.min(nextCol, this.gridCols);
            }
            
            // Update UI to reflect loaded state
            if (this.currentAttemptSpan) {
                this.currentAttemptSpan.textContent = this.currentAttempt;
            }
            
            // Update caret position and row labels
            this.updateCaret();
            this.updateRowLabels();
            this.updatePasteAction();
            
            // Restore color display state
            if (this.gameOver) {
                if (this.postGameActionRow === null && this.guessHistory.length > 0) {
                    this.postGameActionRow = Math.max(0, Math.min(this.gridRows - 1, this.guessHistory.length - 1));
                }
                if (this.postGameActionRow !== null) {
                    this.setRowActionMode(this.postGameActionRow, 'share');
                }

                this.colorDisplay.textContent = '#' + this.targetColor;
                this.colorDisplay.style.background = '#' + this.targetColor;
                this.colorDisplay.classList.remove('hidden');
                this.colorDisplay.classList.add('game-ended');
                this.clearActiveRowIndicators();
                // Ensure timer bar and text are empty for completed games
                this.timerFill.style.transition = '';
                this.timerFill.style.transform = 'scaleX(0)';
                // Show share button on the submitted/final row for completed games
                this.updatePasteAction();
            } else if (this.colorVisible) {
                // Color was being shown when user left - hide it but keep revealed state
                this.colorDisplay.classList.add('hidden');
                this.colorDisplay.textContent = 'Submit a guess to reveal again!';
                this.colorDisplay.style.background = ''; // Clear background
                this.colorVisible = false; // Reset visible flag
                this.colorDisplay.classList.add('disabled');
                // Reset timer bar and text to empty
                this.timerFill.style.transition = '';
                this.timerFill.style.transform = 'scaleX(0)';
            } else if (this.hasRevealedThisAttempt) {
                // User has already revealed color this attempt, disable the button
                this.colorDisplay.classList.add('disabled');
                this.colorDisplay.textContent = 'Submit a guess to reveal again!';
                this.colorDisplay.style.background = ''; // Clear background
                // Reset timer bar and text to empty since color was already revealed
                this.timerFill.style.transition = '';
                this.timerFill.style.transform = 'scaleX(0)';
            }
        } catch (e) {
            console.error('Failed to load daily game state:', e);
            localStorage.removeItem('dailyGameState');
        }
    }
}

// Start the app when the page loads (server-driven daily color)
window.addEventListener('DOMContentLoaded', async () => {
    // Keep hex output scale stable on engines that don't support CSS typed division.
    let hexScaleRaf = 0;
    const syncHexOutputVisualScale = () => {
        const root = document.documentElement;
        const hexOutput = document.querySelector('.hex-output-field');
        const hexOutputContainer = document.querySelector('.hex-output-container');
        if (!hexOutput || !hexOutputContainer) return;

        const focusFontPx = parseFloat(getComputedStyle(hexOutput).fontSize) || 16;
        const containerHeightPx = hexOutputContainer.getBoundingClientRect().height;

        if (!Number.isFinite(containerHeightPx) || !Number.isFinite(focusFontPx) || focusFontPx <= 0) return;

        // container height is 2 * app-scale; desired visual scale is app-scale / focusFontPx
        const scale = containerHeightPx / (2 * focusFontPx);
        if (!Number.isFinite(scale) || scale <= 0) return;
        root.style.setProperty('--hex-output-visual-scale', scale.toFixed(4));
    };

    const queueHexOutputScaleSync = () => {
        if (hexScaleRaf) {
            cancelAnimationFrame(hexScaleRaf);
        }
        hexScaleRaf = requestAnimationFrame(() => {
            hexScaleRaf = 0;
            syncHexOutputVisualScale();
        });
    };

    queueHexOutputScaleSync();
    window.addEventListener('resize', queueHexOutputScaleSync, { passive: true });
    window.addEventListener('orientationchange', queueHexOutputScaleSync);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', queueHexOutputScaleSync, { passive: true });
    }

    // --- Decide mode (path vs local file query) ---
    const isFile = location.protocol === 'file:';
    const pathIsUnlimited  = /\/unlimited\/?$/.test(location.pathname);
    const queryIsUnlimited = new URLSearchParams(location.search).get('mode') === 'unlimited';
    const MODE = isFile ? (queryIsUnlimited ? 'unlimited' : 'daily')
                        : (pathIsUnlimited ? 'unlimited' : 'daily');

    // --- Boot mode ---
    let gameInstance;
    if (MODE === 'unlimited') {
        gameInstance = new HexColorWordle({ mode: 'unlimited' });
    } 
    else {
        try {
            const dailyPuzzle = await fetchDailyPuzzle();
            gameInstance = new HexColorWordle({
                mode: 'daily',
                targetColor: dailyPuzzle.hex,
                dailyPuzzleDate: dailyPuzzle.date
            });
        } 
        catch {
            // graceful fallback if the API isn't reachable in dev
            gameInstance = new HexColorWordle({ mode: 'unlimited' });
        }
    }
    
    // Make game instance globally accessible for restart
    window.gameInstance = gameInstance;

    // --- Mode buttons: navigate correctly in both environments ---
    const modeBtns = document.querySelectorAll('.mode-container .mode-btn');
    const [dailyBtn, unlimitedBtn] = [modeBtns[0], modeBtns[1]];
    if (dailyBtn && unlimitedBtn) {
        const toDaily = isFile ? 'index.html' : '/';
        const toUnlim = isFile ? 'unlimited/index.html' : '/unlimited';

        dailyBtn.addEventListener('click', (e) => { e.preventDefault(); location.href = toDaily; });
        unlimitedBtn.addEventListener('click', (e) => { e.preventDefault(); location.href = toUnlim; });

        dailyBtn.classList.toggle('active', MODE === 'daily');
        unlimitedBtn.classList.toggle('active', MODE === 'unlimited');

        if (MODE === 'daily') {
            dailyBtn.setAttribute('aria-current', 'page');
            unlimitedBtn.removeAttribute('aria-current');
        } 
        else {
            unlimitedBtn.setAttribute('aria-current', 'page');
            dailyBtn.removeAttribute('aria-current');
        }
    }

    // --- Dark mode toggle ---
    const darkModeBtn  = document.getElementById("darkModeToggle");
    if (darkModeBtn) {
        // Sync body with html on page load (in case html already has dark class from inline script)
        const htmlIsDark = document.documentElement.classList.contains('dark');
        if (htmlIsDark) {
            document.body.classList.add('dark');
            darkModeBtn.setAttribute("aria-label", "Light Mode");
        } else {
            darkModeBtn.setAttribute("aria-label", "Dark Mode");
        }

        darkModeBtn.addEventListener("click", () => {
            // Toggle both html and body
            const isDark = document.documentElement.classList.toggle("dark");
            document.body.classList.toggle("dark", isDark);
            document.documentElement.style.backgroundColor = isDark ? '#262626' : '#f5f5f5';
            document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
            
            // Save preference to localStorage
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            
            // Update aria-label
            darkModeBtn.setAttribute("aria-label", isDark ? "Light Mode" : "Dark Mode");
        });
    }

    // --- Toast Notification System ---
    const toastContainer = document.getElementById('toastContainer');

    let toastSyncRaf = 0;
    let lastToastTop = '';
    let toastBounceLocked = false;
    const TOAST_BOUNCE_ENTER_PX = 2;
    const TOAST_BOUNCE_EXIT_PX = 10;

    const getToastViewportOffsetTop = () => {
        const vv = window.visualViewport;
        if (!vv) return 0;

        const rawOffsetTop = Math.max(0, Number(vv.offsetTop) || 0);
        if (rawOffsetTop <= 0) return 0;

        const cappedOffsetTop = Math.min(rawOffsetTop, window.innerHeight * 0.45);

        // Primary: detect bounce directly when pageTop is available.
        const pageTop = Number(vv.pageTop);
        if (Number.isFinite(pageTop)) {
            const scrollingEl = document.scrollingElement || document.documentElement;
            if (!scrollingEl) return cappedOffsetTop;

            const maxScrollY = Math.max(0, scrollingEl.scrollHeight - window.innerHeight);

            const outsideBounceBounds =
                pageTop < -TOAST_BOUNCE_ENTER_PX ||
                pageTop > maxScrollY + TOAST_BOUNCE_ENTER_PX;
            const insideSettledBounds =
                pageTop >= -TOAST_BOUNCE_EXIT_PX &&
                pageTop <= maxScrollY + TOAST_BOUNCE_EXIT_PX;

            if (!toastBounceLocked && outsideBounceBounds) {
                toastBounceLocked = true;
            } else if (toastBounceLocked && insideSettledBounds) {
                toastBounceLocked = false;
            }

            if (toastBounceLocked) return 0;

            return cappedOffsetTop;
        }

        // pageTop unavailable: avoid stale lock carrying forward.
        toastBounceLocked = false;

        // Fallback: infer keyboard-open state when pageTop is unavailable.
        const delta = Math.max(0, window.innerHeight - vv.height);
        const threshold = Math.max(100, window.innerHeight * 0.20);
        if (delta <= threshold) return 0;

        return cappedOffsetTop;
    };

    const syncToastViewportOffset = () => {
        if (!toastContainer) return;

        const offsetTop = getToastViewportOffsetTop();
        const topValue = `calc(var(--toast-top) + env(safe-area-inset-top, 0px) + ${offsetTop}px)`;

        if (topValue !== lastToastTop) {
            toastContainer.style.top = topValue;
            lastToastTop = topValue;
        }
    };

    const queueToastViewportSync = () => {
        if (toastSyncRaf) return;
        toastSyncRaf = requestAnimationFrame(() => {
            toastSyncRaf = 0;
            syncToastViewportOffset();
        });
    };

    syncToastViewportOffset();
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', queueToastViewportSync, { passive: true });
        window.visualViewport.addEventListener('scroll', queueToastViewportSync, { passive: true });
    } else {
        // Fallback only when visualViewport is unavailable.
        window.addEventListener('scroll', queueToastViewportSync, { passive: true });
    }
    window.addEventListener('orientationchange', () => {
        toastBounceLocked = false;
        queueToastViewportSync();
        requestAnimationFrame(queueToastViewportSync);
        setTimeout(syncToastViewportOffset, 120);
    }, { passive: true });
    
    function showToast(message, duration = 2000) {
        if (!toastContainer) return;
        syncToastViewportOffset();
        
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        
        toastContainer.appendChild(toast);
        
        // Force reflow to ensure initial state is rendered
        void toast.offsetWidth;
        
        // Trigger show animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        
        // Auto-hide after duration
        setTimeout(() => {
            toast.classList.remove('show');
            toast.classList.add('hide');
            
            // Remove from DOM after animation
            setTimeout(() => {
                toast.remove();
            }, 200);
        }, duration);
    }
    
    // Make showToast globally accessible
    window.showToast = showToast;

    // --- Reusable Modal System ---
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modalBody');
    const modalOverlay = modal?.querySelector('.modal-overlay');
    
    let focusTrapHandler = null;
    let lockedScrollY = 0;
    let modalOpenedAt = 0;

    function setupFocusTrap() {
        // Remove old handler if exists
        if (focusTrapHandler) {
            document.removeEventListener('keydown', focusTrapHandler);
        }

        // Focus the modal content container itself so focus is immediately
        // inside the modal — not on the x button, not on the grid.
        // modal-content must have tabIndex="-1" in HTML for this to work.
        const modalContent = modal.querySelector('.modal-content');
        if (modalContent) {
            modalContent.focus({ preventScroll: true });
        }

        // Create trap handler — keeps Tab cycling within modal, wraps at edges
        focusTrapHandler = (e) => {
            if (e.key !== 'Tab') return;

            const modalIsOpen = document.body.classList.contains('modal-open');
            if (!modalIsOpen) return;

            // Query fresh each time — content can change
            const focusableSelectors = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
            const focusableArray = Array.from(modal.querySelectorAll(focusableSelectors))
                .filter(el => el.offsetParent !== null);

            if (focusableArray.length === 0) return;

            const firstFocusable = focusableArray[0];
            const lastFocusable = focusableArray[focusableArray.length - 1];
            const active = document.activeElement;

            if (e.shiftKey) {
                if (active === firstFocusable || !modal.contains(active)) {
                    e.preventDefault();
                    lastFocusable.focus();
                }
            } else {
                if (active === lastFocusable || !modal.contains(active)) {
                    e.preventDefault();
                    firstFocusable.focus();
                }
            }
        };

        document.addEventListener('keydown', focusTrapHandler);
    }

    function openModal(content) {
        if (!modal || !modalBody) return;
        modalBody.innerHTML = content;
        modal.style.display = 'flex';
        modalOpenedAt = Date.now();
        
        // Block background interactions
        lockedScrollY = window.scrollY || window.pageYOffset || 0;
        document.documentElement.classList.add('modal-open');
        document.body.classList.add('modal-open');
        document.body.style.top = `-${lockedScrollY}px`;
        
        // Attach close button handler (now inside modal content)
        const modalClose = modalBody.querySelector('.modal-close');
        if (modalClose) {
            modalClose.addEventListener('click', closeModal);
        }
        
        // Setup focus trap: find all focusable elements in modal
        setupFocusTrap();
        
        // Force reflow to ensure initial state is rendered
        void modal.offsetWidth;
        
        // Trigger animation on next frame
        requestAnimationFrame(() => {
            modal.classList.add('open');
        });
    }

    function closeModal() {
        if (!modal) return;
        modal.classList.remove('open');
        
        // Re-enable background interactions
        document.documentElement.classList.remove('modal-open');
        document.body.classList.remove('modal-open');
        document.body.style.top = '';
        window.scrollTo(0, lockedScrollY);
        
        // Remove focus trap handler
        if (focusTrapHandler) {
            document.removeEventListener('keydown', focusTrapHandler);
            focusTrapHandler = null;
        }
        
        // Wait for animation to finish before hiding
        setTimeout(() => {
            modal.style.display = 'none';
            // Refocus the grid after modal closes so paste works again
            if (window.gameInstance && window.gameInstance.gridEl) {
                safeFocus(window.gameInstance.gridEl);
            }
        }, 200); // matches transition duration
    }

    // Overlay close handlers
    if (modalOverlay) {
        const closeModalFromTouch = (e) => {
            e.preventDefault();
            if (document.body.classList.contains('modal-open')) {
                closeModal();
            }
        };

        if (window.PointerEvent) {
            modalOverlay.addEventListener('pointerup', (e) => {
                if (e.pointerType === 'touch' || e.pointerType === 'pen') {
                    closeModalFromTouch(e);
                }
            }, { passive: false });
        } else {
            modalOverlay.addEventListener('touchend', closeModalFromTouch, { passive: false });
        }

        modalOverlay.addEventListener('click', closeModal);
    }

    // Global keyboard event blocker for modal
    // Prevents all keyboard input to background when modal is open
    document.addEventListener('keydown', (e) => {
        const modalIsOpen = document.body.classList.contains('modal-open');

        if (modalIsOpen) {
            // Always allow Escape to close modal
            if (e.key === 'Escape') {
                e.preventDefault();
                closeModal();
                return;
            }

            // Always allow browser zoom shortcuts (Cmd/Ctrl +/=/−/_ and reset 0)
            const isZoom = (e.metaKey || e.ctrlKey) && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' || e.key === '0');
            if (isZoom) return;

            // Check if the event target or active element is inside the modal.
            // Using both covers the timing gap right after modal opens before
            // focus has fully moved, and cases where e.target is document/body.
            const isInsideModal = modal && (modal.contains(e.target) || modal.contains(document.activeElement));

            // Block all keyboard events targeting elements outside the modal
            if (!isInsideModal) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }, true); // Use capture phase to intercept before game handlers
    
    // Also block paste events when modal is open
    document.addEventListener('paste', (e) => {
        const modalIsOpen = document.body.classList.contains('modal-open');
        if (modalIsOpen) {
            e.stopPropagation();
        }
    }, true); // Use capture phase
    
    // Block scroll/wheel events on background when modal is open
    document.addEventListener('wheel', (e) => {
        const modalIsOpen = document.body.classList.contains('modal-open');
        if (modalIsOpen && !modal.contains(e.target)) {
            e.preventDefault();
        }
    }, { passive: false, capture: true });

    // Safari fallback: suppress double-tap smart zoom on non-interactive surfaces.
    const MODAL_OPEN_GUARD_MS = 500;
    const DOUBLE_TAP_WINDOW_MS = 350;
    const DOUBLE_TAP_DISTANCE_PX = 30;
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    document.addEventListener('touchend', (e) => {
        if (!e.changedTouches || e.changedTouches.length !== 1) return;
        if (e.touches && e.touches.length > 0) return;

        const target = e.target instanceof Element
            ? e.target
            : (e.target && e.target.parentElement ? e.target.parentElement : null);
        if (!target) return;

        // Don't interfere with controls that may legitimately need rapid taps.
        const isEditable = target.closest('input, textarea, select, [contenteditable="true"]');
        const isInteractive = target.closest('button, label, summary, details, [role="button"], [data-allow-doubletap]');
        const isNonInteractive = !isEditable && !isInteractive;

        const touch = e.changedTouches[0];
        const now = Date.now();
        const dt = now - lastTapTime;
        const dx = Math.abs(touch.clientX - lastTapX);
        const dy = Math.abs(touch.clientY - lastTapY);
        const isRapidDoubleTap =
            dt > 0 &&
            dt < DOUBLE_TAP_WINDOW_MS &&
            dx < DOUBLE_TAP_DISTANCE_PX &&
            dy < DOUBLE_TAP_DISTANCE_PX;
        const isModalOpenRaceTap =
            document.body.classList.contains('modal-open') &&
            !!target.closest('.modal-content') &&
            now - modalOpenedAt < MODAL_OPEN_GUARD_MS;

        if (isNonInteractive && (isRapidDoubleTap || isModalOpenRaceTap)) {
            e.preventDefault();
        }

        lastTapTime = now;
        lastTapX = touch.clientX;
        lastTapY = touch.clientY;
    }, { passive: false, capture: true });

    function openHelpModal() {
        const helpContent = `
            <div class="title">
                HOW TO PLAY
                <button class="modal-close" id="modalClose" aria-label="Close">
                    <svg class="icon" viewBox="0 0 15 15" aria-hidden="true">
                        <use href="#icon-cancel"></use>
                    </svg>
                </button>
            </div>
                <div class="modal-body-text">
                    <p class="modal-paragraph modal-section-paragraph"><span class="modal-section-box modal-section-header">Goal</span></p>
                    <p class="modal-paragraph">Match the hidden target color by entering its corresponding 6-digit hex code into the grid.</p>
                    <p class="modal-paragraph modal-section-paragraph"><span class="modal-section-box modal-section-header">Rules</span></p>
                    <p class="modal-paragraph">You get 5 attempts, and can only reveal the target color for a short time once per attempt. Click the reveal square to briefly preview the target color, then use the color canvas and hue slider to help you guess. You can fine tune your guess by manually editing the text field under the color preview, and then copy/paste it into the grid. Submit once you're ready, and use the grid color feedback to improve your next guess.</p>
                    <p class="modal-paragraph modal-section-paragraph"><span class="modal-section-box modal-section-header">Feedback</span></p>
                    <ul class="color-list">
                        <li class="modal-list-item"><span class="color-legend-swatch color-legend-swatch--correct"></span> = Digit is correct</li>
                        <li class="modal-list-item"><span class="color-legend-swatch color-legend-swatch--close"></span> = Digit is off by 1</li>
                        <li class="modal-list-item"><span class="color-legend-swatch color-legend-swatch--near"></span> = Digit is off by 2 or 3</li>
                        <li class="modal-list-item"><span class="color-legend-swatch color-legend-swatch--far"></span> = Digit is off by more than 3</li>
                    </ul>
                    <p class="modal-paragraph modal-section-paragraph"><span class="modal-section-box modal-section-header">Tips & Controls</span></p>
                    <p class="modal-paragraph">With each attempt, the amount of time the target color is shown per reveal increases. You can click on the "#" in any row with a submitted guess to quickly paste it back into the color picker. On mobile you have to tap the color canvas and hue slider first before they become interactable.</p>
                    <p class="modal-paragraph modal-section-paragraph"><span class="modal-section-box modal-section-header">Modes</span></p>
                    <p class="modal-paragraph">Daily mode gives every player the same global color each day. Unlimited mode gives you endless random colors for practice.</p>
                    <p class="modal-footer-text">New to hex codes? Click <a href="https://www.w3schools.com/html/html_colors_hex.asp" target="_blank" class="modal-link">here</a>.</p>
                </div>
        `;
        openModal(helpContent);
        localStorage.setItem('onboardingHelpSeen', '1');
    }

    // Info/Help button
    const infoBtn = document.getElementById('infoButton');
    if (infoBtn) {
        infoBtn.addEventListener('click', () => {
            markAutoPopupBypassed('onboardingHelpAuto');
            markAutoPopupBypassed('statsOnLoadAuto');
            markAutoPopupBypassed('statsEndgameAuto');
            openHelpModal();
        });
    }

    // Show onboarding help once for first-time users (no gameplay save data yet).
    const onboardingHelpSeenKey = 'onboardingHelpSeen';
    const hasSeenOnboardingHelp = localStorage.getItem(onboardingHelpSeenKey) === '1';
    const hasGameplaySaveData = (
        localStorage.getItem('dailyGameState') ||
        localStorage.getItem('dailyCompletion') ||
        localStorage.getItem('gameStats_daily') ||
        localStorage.getItem('gameStats_unlimited')
    );
    if (!hasSeenOnboardingHelp && !hasGameplaySaveData) {
        const autoChannel = 'onboardingHelpAuto';
        autoPopupBypassState[autoChannel].pending = true;
        // Small delay so the first-load modal feels less abrupt.
        setTimeout(() => {
            autoPopupBypassState[autoChannel].pending = false;
            if (shouldSuppressAutoPopup(autoChannel)) return;
            if (!document.body.classList.contains('modal-open')) {
                openHelpModal();
            }
        }, 1000);
    }

    // Stats button
    const statsBtn = document.getElementById('statsButton');
    if (statsBtn) {
        statsBtn.addEventListener('click', () => {
            markAutoPopupBypassed('statsOnLoadAuto');
            markAutoPopupBypassed('statsEndgameAuto');
            // Check if daily mode game is completed (either loaded as completed or just finished)
            const isDailyCompleted = window.gameInstance?.mode === 'daily' && window.gameInstance?.gameOver;
            showStatsModal(isDailyCompleted);
        });
    }

    function showStatsModal(dailyAlreadyCompleted = false) {
        const mode = window.gameInstance?.mode || 'daily';
        const stats = getStats(mode);
        const isGameOver = window.gameInstance?.gameOver || false;
        const puzzleDate = window.gameInstance?.dailyPuzzleDate || null;
        const todayUtc = new Date().toISOString().split('T')[0];
        const hasNextDailyAvailable =
            mode === 'daily' &&
            !!puzzleDate &&
            todayUtc > puzzleDate;
        
        // Determine button content
        let buttonContent;
        if (dailyAlreadyCompleted && mode === 'daily') {
            if (hasNextDailyAvailable) {
                // New daily is already available on this same page session.
                buttonContent = '<button type="button" class="stats-button" onclick="window.location.reload()">PLAY NEW COLOR!</button>';
            } else {
                // Show countdown timer for next daily color
                buttonContent = '<div id="nextColorTimer" class="stats-button">Next color in&nbsp;<span id="timerDisplay">--:--:--</span></div>';
            }
        } else if (isGameOver) {
            // Game is over - show "PLAY AGAIN!" button that restarts
            buttonContent = '<button class="stats-button" onclick="window.closeModalAndPlay()">PLAY AGAIN!</button>';
        } else {
            // Game is in progress - show "PLAY!" button that just closes modal
            buttonContent = '<button class="stats-button" onclick="closeModal()">PLAY!</button>';
        }
        
        const statsContent = `
            <div class="title">
                STATISTICS
                <button class="modal-close" id="modalClose" aria-label="Close">
                    <svg class="icon" viewBox="0 0 15 15" aria-hidden="true">
                        <use href="#icon-cancel"></use>
                    </svg>
                </button>
            </div>
            <div class="stats-body">
                <div class="stats-grid" id="statsGrid">
                    ${createStatCell(stats.gamesPlayed, 'Games Played', 0)}
                    ${createStatCell(stats.gamesWon, 'Games Won', 1)}
                    ${createStatCell(stats.gamesLost, 'Games Lost', 2)}
                    ${createStatCell(stats.winPercentage, 'Win Pct.', 3)}
                    ${createStatCell(stats.currentStreak, 'Current Streak', 4)}
                    ${createStatCell(stats.maxStreak, 'Max Streak', 5)}
                    ${createStatCell(stats.avgGuesses, 'Avg. Guesses', 6)}
                    ${createStatCell(stats.avgColorAccuracy, 'Guess Accuracy', 7)}
                    ${createStatCell(stats.guessEfficiency, 'Guess Efficiency', 8)}
                </div>
                ${buttonContent}
                <p class="stats-note">* Statistics shown for ${mode} mode</p>
            </div>
        `;
        openModal(statsContent);
        
        // Start countdown timer if daily already completed
        if (dailyAlreadyCompleted && mode === 'daily' && !hasNextDailyAvailable) {
            startNextColorTimer();
        }
        
        // Initialize easter egg
        initStatsGridEasterEgg();
    }
    
    function startNextColorTimer() {
        const timerDisplay = document.getElementById('timerDisplay');
        if (!timerDisplay) return;

        // Compute the target once
        const target = new Date();
        target.setUTCHours(24, 0, 0, 0); // next midnight UTC

        let interval = null;
        let observer = null;

        function updateTimer() {
            const now = new Date();
            const diff = target - now;

            if (diff <= 0) {
                const timerContainer = document.getElementById('nextColorTimer');
                if (timerContainer) {
                    const playButton = document.createElement('button');
                    playButton.type = 'button';
                    playButton.className = 'stats-button';
                    playButton.textContent = 'PLAY NEW COLOR!';
                    playButton.onclick = () => window.location.reload();
                    timerContainer.replaceWith(playButton);
                }
                if (interval) clearInterval(interval);
                if (observer) observer.disconnect();
                return;
            }

            const hours   = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            timerDisplay.textContent =
                `${String(hours).padStart(2, '0')}:` +
                `${String(minutes).padStart(2, '0')}:` +
                `${String(seconds).padStart(2, '0')}`;
        }

        updateTimer();
        interval = setInterval(updateTimer, 1000);
        
        // Clear interval when modal is closed
        const modal = document.getElementById('modal');
        observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'style' && modal.style.display === 'none') {
                    if (interval) clearInterval(interval);
                    observer.disconnect();
                }
            });
        });
        observer.observe(modal, { attributes: true });
    }

    function createStatCell(value, label, index) {
        const stackedLabel = String(label).trim().split(/\s+/).join('<br>');

        return `
            <div class="stat-cell" data-index="${index}">
                <span class="stat-value">${value}</span>
                <span class="stat-label">${stackedLabel}</span>
            </div>
        `;
    }
    
    function initStatsGridEasterEgg() {
        const grid = document.getElementById('statsGrid');
        if (!grid) return;
        
        const cells = grid.querySelectorAll('.stat-cell');
        if (cells.length !== 9) return;
        
        // Easter egg colors
        const colors = [
            '#F33800', // red
            '#FF8200', // orange
            '#FFC500', // yellow
            '#72CA00', // lime
            '#009442', // green
            '#00BFBD', // cyan
            '#006CAD', // blue
            '#5E2AA6', // indigo
            '#B40075'  // violet
        ];
        
        let usedColors = new Set();
        let isAnimating = false;
        
        cells.forEach((cell, idx) => {
            cell.style.cursor = 'pointer';
            
            cell.addEventListener('click', () => {
                if (isAnimating) return;
                isAnimating = true;
                usedColors.clear();
                
                // Start cascade from clicked cell and reset flag when done
                cascadeColors(idx, cells, colors, usedColors, () => {
                    isAnimating = false;
                });
            });
        });
    }
    
    function cascadeColors(startIndex, cells, colors, usedColors, onComplete) {
        const visited = new Set();
        const queue = [startIndex];
        visited.add(startIndex);
        
        function getAdjacentIndices(index) {
            const row = Math.floor(index / 3);
            const col = index % 3;
            const adjacent = [];
            
            // Up, down, left, right
            if (row > 0) adjacent.push(index - 3);
            if (row < 2) adjacent.push(index + 3);
            if (col > 0) adjacent.push(index - 1);
            if (col < 2) adjacent.push(index + 1);
            
            return adjacent;
        }
        
        // Build the full queue first using BFS
        let queueIndex = 0;
        while (queueIndex < queue.length) {
            const currentIndex = queue[queueIndex];
            const adjacent = getAdjacentIndices(currentIndex);
            
            adjacent.forEach(adjIndex => {
                if (!visited.has(adjIndex)) {
                    visited.add(adjIndex);
                    queue.push(adjIndex);
                }
            });
            
            queueIndex++;
        }
        
        // Now animate each cell in order with delays
        queue.forEach((index, i) => {
            const delay = i * 150;
            
            setTimeout(() => {
                const cell = cells[index];
                
                // Get available colors
                const availableColors = colors.filter(c => !usedColors.has(c));
                if (availableColors.length === 0) return;
                
                // Pick random color from available
                const color = availableColors[Math.floor(Math.random() * availableColors.length)];
                usedColors.add(color);
                
                // Change background color and add active class FIRST (instant)
                cell.style.background = color;
                cell.classList.add('easter-egg-active');
                
                // Then apply pop animation
                cell.classList.add('land-pop');
                setTimeout(() => cell.classList.remove('land-pop'), 120);
                
                // Call completion callback after last cell
                if (i === queue.length - 1) {
                    setTimeout(() => {
                        if (onComplete) onComplete();
                    }, 300);
                }
            }, delay);
        });
    }

    function getStats(mode = 'daily') {
        function formatPercent(value, includePlus = false) {
            const rounded = Math.round(value * 10) / 10;
            const normalized = Object.is(rounded, -0) ? 0 : rounded;
            const sign = includePlus && normalized > 0 ? '+' : '';
            const numberText = Number.isInteger(normalized)
                ? String(normalized)
                : normalized.toFixed(1);
            return `${sign}${numberText}%`;
        }

        const storageKey = `gameStats_${mode}`;
        const savedStats = localStorage.getItem(storageKey);
        const defaultStats = {
            gamesPlayed: 0,
            gamesWon: 0,
            gamesLost: 0,
            winPercentage: '0%',
            currentStreak: 0,
            maxStreak: 0,
            avgGuesses: '--',
            avgColorAccuracy: '--',
            accuracyLabel: '',
            guessEfficiency: '--',
            efficiencyLabel: ''
        };
        
        if (!savedStats) return defaultStats;
        
        try {
            const stats = JSON.parse(savedStats);
            // Calculate derived stats
            stats.winPercentage = stats.gamesPlayed > 0
                ? formatPercent((stats.gamesWon / stats.gamesPlayed) * 100)
                : '0%';
            // Count all guesses across all games (wins and losses)
            stats.avgGuesses = stats.gamesPlayed > 0 
                ? (stats.totalGuessesAllGames / stats.gamesPlayed).toFixed(2)
                : '--';
            
            // Convert color error to accuracy percentage
            const maxColorDistance = 441.67; // sqrt(255^2 * 3)
            if (stats.totalGuessesAllGames > 0) {
                const avgError = stats.totalColorErrorAllGuesses / stats.totalGuessesAllGames;
                const accuracyPercent = ((1 - (avgError / maxColorDistance)) * 100);
                stats.avgColorAccuracy = formatPercent(accuracyPercent);
                
                // Add descriptor
                if (accuracyPercent >= 95) stats.accuracyLabel = 'Extremely Accurate';
                else if (accuracyPercent >= 90) stats.accuracyLabel = 'Very Accurate';
                else if (accuracyPercent >= 80) stats.accuracyLabel = 'Accurate';
                else if (accuracyPercent >= 70) stats.accuracyLabel = 'Pretty Good';
                else if (accuracyPercent >= 60) stats.accuracyLabel = 'Decent';
                else stats.accuracyLabel = 'Needs Work';
            } else {
                stats.avgColorAccuracy = '--';
                stats.accuracyLabel = '';
            }
            
            // Convert error reduction to percentage improvement
            if (stats.totalGuessesAllGames > 1) {
                const avgReduction = stats.totalErrorReduction / (stats.totalGuessesAllGames - stats.gamesPlayed);
                const improvementPercent = ((avgReduction / maxColorDistance) * 100);
                stats.guessEfficiency = formatPercent(improvementPercent, true);
                
                // Add descriptor
                if (improvementPercent >= 5) stats.efficiencyLabel = 'Excellent Progress';
                else if (improvementPercent >= 3) stats.efficiencyLabel = 'Great Progress';
                else if (improvementPercent >= 2) stats.efficiencyLabel = 'Good Progress';
                else if (improvementPercent >= 1) stats.efficiencyLabel = 'Steady Progress';
                else if (improvementPercent > 0) stats.efficiencyLabel = 'Slow Progress';
                else stats.efficiencyLabel = 'Inconsistent';
            } else {
                stats.guessEfficiency = '--';
                stats.efficiencyLabel = '';
            }
            return stats;
        } catch (e) {
            return defaultStats;
        }
    }

    function saveStats(stats, mode = 'daily') {
        const storageKey = `gameStats_${mode}`;
        localStorage.setItem(storageKey, JSON.stringify(stats));
    }

    window.closeModalAndPlay = function() {
        closeModal();
        // Restart the game
        if (window.gameInstance && typeof window.gameInstance.restartGame === 'function') {
            window.gameInstance.restartGame();
        }
    };

    // Make stats and modal functions globally accessible
    window.showStatsModal = showStatsModal;
    window.getStats = getStats;
    window.saveStats = saveStats;
    window.closeModal = closeModal;
});
