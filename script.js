// OS Process Scheduling & Interrupt Simulation (Single Interrupt, FCFS, Animated)
(function() {
  // State
  let readyQ = [];
  let pendingQ = [];
  let waitingQ = [];
  let finishedQ = [];
  let cpu = null;
  let pidCounter = 1;
  let clock = 0;
  let clockTimer = null;
  let isrActive = false;
  let interruptPending = false;
  let interruptDeferred = false; // request to handle interrupt after current tick
  let blockScheduling = false; // pause scheduling while handling an interrupt
  let lastInterruptType = 'I/O Interrupt';
  // Interrupt queue and priorities
  let interruptQueue = [];
  let interruptSeq = 0; // arrival order for tie-break
  let schedulerStarted = false;
  const interruptPriority = {
    'Power Cut': 4,
    'Timer Interrupt': 3,
    'Device Interrupt': 2,
    'Mouse Interrupt': 1,
    'I/O Interrupt': 1
  };
  let quantum = 3; // default quantum in ticks
  let quantumUsed = 0;
  let quantumTimer = null;
  let isPaused = false;
  const pausableTimeouts = new Set();
  const tickIntervalMs = 6000;
  const isrDelayFactor = 1.35;

  // DOM
  const readyEl = document.getElementById('readyQueue');
  const waitingEl = document.getElementById('waitingQueue');
  const finishedEl = document.getElementById('finishedQueue');
  const cpuBox = document.getElementById('cpuBox');
  const cpuProcessEl = document.getElementById('cpuProcess');
  const cpuLabel = document.getElementById('cpuLabel');
  const interruptArrow = document.getElementById('interruptArrow');
  // Interrupt queue UI
  let interruptQueueEl = document.getElementById('interruptQueue');
  if (!interruptQueueEl) {
    interruptQueueEl = document.createElement('div');
    interruptQueueEl.id = 'interruptQueue';
    interruptQueueEl.style.margin = '12px 0 0 0';
    interruptQueueEl.style.fontSize = '1.08em';
    interruptQueueEl.style.color = '#f59e42';
    interruptQueueEl.style.fontWeight = 'bold';
    interruptQueueEl.style.padding = '6px 0 6px 0';
    interruptQueueEl.style.textAlign = 'center';
    interruptArrow.parentNode.insertBefore(interruptQueueEl, interruptArrow.nextSibling);
  }
  const isrSteps = document.getElementById('isrSteps');
  const pcbBody = document.querySelector('#pcbTable tbody');
  const sysClock = document.getElementById('sysClock');
  const quantumInput = document.getElementById('quantumInput');
  const scheduleAlgo = document.getElementById('scheduleAlgo');
  const procPriority = document.getElementById('procPriority');
  const startScheduler = document.getElementById('startScheduler');
  const pauseToggle = document.getElementById('pauseToggle');
  const timesliceLabel = document.getElementById('timesliceLabel');
  const tabInterrupt = document.getElementById('tabInterrupt');
  const tabMonitor = document.getElementById('tabMonitor');
  const tabContentInterrupt = document.getElementById('tabContentInterrupt');
  const tabContentMonitor = document.getElementById('tabContentMonitor');
  const systemLogs = document.getElementById('systemLogs');
  // System log helper
  function logEvent(msg) {
    if (!systemLogs) return;
    const li = document.createElement('li');
    li.textContent = `[${clock}] ${msg}`;
    systemLogs.appendChild(li);
    // Scroll to bottom
    systemLogs.scrollTop = systemLogs.scrollHeight;
  }

  function speak(text) {
    if (!window.speechSynthesis) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1;
    utter.pitch = 1;
    utter.lang = 'en-US';
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) {
      synth.cancel();
    }
    synth.resume();
    synth.speak(utter);
  }

  function setPausableTimeout(fn, delay) {
    const t = { id: null, remaining: delay, start: 0, fn };
    const schedule = () => {
      t.start = Date.now();
      t.id = setTimeout(() => {
        t.id = null;
        pausableTimeouts.delete(t);
        if (!isPaused) {
          fn();
        } else {
          t.remaining = 0;
          pausableTimeouts.add(t);
        }
      }, t.remaining);
    };
    schedule();
    pausableTimeouts.add(t);
    return t;
  }

  function pauseAllTimeouts() {
    pausableTimeouts.forEach(t => {
      if (!t.id) return;
      clearTimeout(t.id);
      t.remaining -= Date.now() - t.start;
      if (t.remaining < 0) t.remaining = 0;
      t.id = null;
    });
  }

  function resumeAllTimeouts() {
    pausableTimeouts.forEach(t => {
      if (t.id) return;
      t.start = Date.now();
      t.id = setTimeout(() => {
        t.id = null;
        pausableTimeouts.delete(t);
        if (!isPaused) {
          t.fn();
        } else {
          t.remaining = 0;
          pausableTimeouts.add(t);
        }
      }, t.remaining);
    });
  }

  // Helpers
  const procColors = [
    '#60a5fa', '#f472b6', '#fbbf24', '#34d399', '#a78bfa', '#f87171', '#38bdf8', '#facc15', '#4ade80', '#f472b6', '#fcd34d', '#818cf8'
  ];
  function getProcColor(pid) {
    return procColors[(pid - 1) % procColors.length];
  }
  function createProcBox(p, queueType) {
    const el = document.createElement('div');
    el.className = 'process-box ' + p.state.toLowerCase();
    const prio = typeof p.priority === 'number' ? p.priority : '-';
    const showPrio = getSelectedAlgo() === 'PRIORITY';
    const prioText = showPrio ? ` | P:${prio}` : '';
    el.textContent = `PID ${p.pid} | PC:${p.pc}${prioText} | ${p.state}`;
    const baseColor = getProcColor(p.pid);
    el.style.borderColor = baseColor;
    if (p.state === 'Running') {
      el.style.background = baseColor;
      el.style.color = '#fff';
    } else {
      el.style.background = `${baseColor}33`;
      el.style.color = '#e6eef8';
    }
    // Only show interrupt button for CPU process
    if (queueType === 'cpu') {
      const btn = document.createElement('button');
      btn.textContent = 'Interrupt';
      btn.style.marginLeft = '12px';
      btn.style.fontSize = '0.95em';
      btn.style.padding = '2px 10px';
      btn.style.borderRadius = '6px';
      btn.style.border = 'none';
      btn.style.background = '#a78bfa';
      btn.style.color = '#18181b';
      btn.style.cursor = 'pointer';
      btn.onclick = function(e) {
        e.stopPropagation();
        const typeSel = document.getElementById('interruptType');
        const type = typeSel ? typeSel.value : 'I/O Interrupt';
        queueInterrupt(type, p.pid);
      };
      el.appendChild(btn);
    }
    return el;
  }
  function updatePCB() {
    pcbBody.innerHTML = '';
    // Collect all processes ever created
    let allProcs = [];
    // Add all from queues
    allProcs = allProcs.concat(pendingQ, readyQ, waitingQ, finishedQ);
    if (cpu) allProcs.push(cpu);
    // Remove duplicates by PID
    const seen = {};
    allProcs = allProcs.filter(p => {
      if (seen[p.pid]) return false;
      seen[p.pid] = true;
      return true;
    });
    // Sort by PID
    const showPrio = getSelectedAlgo() === 'PRIORITY';
    allProcs.sort((a, b) => a.pid - b.pid).forEach(p => {
      const tr = document.createElement('tr');
      const prio = typeof p.priority === 'number' ? p.priority : '-';
      const stateClass = `state-${String(p.state).toLowerCase()}`;
      tr.innerHTML = `<td>${p.pid}</td><td>${p.length}</td><td>${p.pc}</td><td class="prio-col">${prio}</td><td><span class="state-tag ${stateClass}">${p.state}</span></td><td>${p.location}</td>`;
      const prioCell = tr.querySelector('.prio-col');
      if (prioCell) {
        prioCell.style.display = showPrio ? '' : 'none';
      }
      pcbBody.appendChild(tr);
    });
  }
  // Spinner animation state
  let spinnerInterval = null;
  let spinnerStep = 0;
  function renderInterruptQueue() {
    if (!interruptQueueEl) return;
    if (interruptQueue.length === 0) {
      interruptQueueEl.textContent = '';
      return;
    }
    const view = interruptQueue
      .slice()
      .sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    interruptQueueEl.innerHTML = 'Pending Interrupts: ' + view.map(i => `<span style="color:${i.type==='Power Cut'?'#ef4444':i.type==='Timer Interrupt'?'#38bdf8':i.type==='Device Interrupt'?'#a78bfa':'#f59e42'};margin:0 8px;">${i.type}</span>`).join('');
  }

  function getSelectedAlgo() {
    return scheduleAlgo ? scheduleAlgo.value : 'RR';
  }


  function getRemaining(p) {
    return p.length - p.pc;
  }

  function selectReadyIndex(scoreFn) {
    if (readyQ.length === 0) return -1;
    let bestIndex = 0;
    let bestScore = scoreFn(readyQ[0]);
    for (let i = 1; i < readyQ.length; i++) {
      const score = scoreFn(readyQ[i]);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  function pickNextReadyProcess() {
    const algo = getSelectedAlgo();
    if (readyQ.length === 0) return null;
    let idx = 0;
    if (algo === 'SJF') {
      idx = selectReadyIndex(p => p.length);
    } else if (algo === 'SRTF') {
      idx = selectReadyIndex(p => getRemaining(p));
    } else if (algo === 'PRIORITY') {
      idx = selectReadyIndex(p => -p.priority);
    } else {
      idx = 0; // RR or FCFS: FIFO
    }
    return readyQ.splice(idx, 1)[0];
  }

  function maybePreempt() {
    if (!cpu || isrActive || interruptPending || blockScheduling) return;
    const algo = getSelectedAlgo();
    if (algo === 'SRTF') {
      const bestIdx = selectReadyIndex(p => getRemaining(p));
      if (bestIdx >= 0 && getRemaining(readyQ[bestIdx]) < getRemaining(cpu)) {
        cpu.state = 'Ready';
        cpu.location = 'Ready';
        readyQ.push(cpu);
        logEvent(`SRTF preempted PID ${cpu.pid}`);
        cpu = null;
        render();
        schedule();
      }
    } else if (algo === 'PRIORITY') {
      const bestIdx = selectReadyIndex(p => -p.priority);
      if (bestIdx >= 0 && readyQ[bestIdx].priority > cpu.priority) {
        cpu.state = 'Ready';
        cpu.location = 'Ready';
        readyQ.push(cpu);
        logEvent(`Priority preempted PID ${cpu.pid}`);
        cpu = null;
        render();
        schedule();
      }
    }
  }

  function insertReadyProcess(p) {
    const algo = getSelectedAlgo();
    if (algo === 'SJF' || algo === 'SRTF') {
      const idx = readyQ.findIndex(q => q.length > p.length || (q.length === p.length && q.pid > p.pid));
      if (idx === -1) readyQ.push(p);
      else readyQ.splice(idx, 0, p);
      return;
    }
    if (algo === 'PRIORITY') {
      const idx = readyQ.findIndex(q => q.priority < p.priority || (q.priority === p.priority && q.pid > p.pid));
      if (idx === -1) readyQ.push(p);
      else readyQ.splice(idx, 0, p);
      return;
    }
    readyQ.push(p); // RR/FCFS
  }

  function addProcessToReady(p) {
    p.state = 'Ready';
    p.location = 'Ready';
    insertReadyProcess(p);
  }

  function buildReadyFromPending() {
    const algo = getSelectedAlgo();
    let ordered = pendingQ.slice();
    if (algo === 'SJF' || algo === 'SRTF') {
      ordered.sort((a, b) => a.length - b.length || a.pid - b.pid);
    } else if (algo === 'PRIORITY') {
      ordered.sort((a, b) => b.priority - a.priority || a.pid - b.pid);
    }
    pendingQ = [];
    ordered.forEach(p => addProcessToReady(p));
  }

  function render() {
    // Queues
    readyEl.innerHTML = '';
    waitingEl.innerHTML = '';
    finishedEl.innerHTML = '';
    readyQ.forEach(p => readyEl.appendChild(createProcBox(p, 'ready')));
    waitingQ.forEach(p => waitingEl.appendChild(createProcBox(p, 'waiting')));
    finishedQ.forEach(p => finishedEl.appendChild(createProcBox(p, 'finished')));
    // CPU
    // ===== CPU RENDER LOGIC (FIXED) =====
    if (isrActive || interruptPending) {
      // Interrupt is being handled OR waiting to be handled
      const nextType =
        isrActive
          ? lastInterruptType
          : interruptQueue
              .slice()
              .sort((a, b) => b.priority - a.priority || a.seq - b.seq)[0]?.type;

      cpuProcessEl.className = 'process-box running';
      cpuProcessEl.textContent = `Handling ${nextType || 'Interrupt'}...`;
      cpuProcessEl.style.background = '#f59e42';
      cpuProcessEl.style.borderColor = '#f59e42';
      cpuProcessEl.style.color = '#222';
      cpuLabel.textContent = 'ISR / Interrupt';
      stopSpinner();
    } else if (cpu) {
      cpuProcessEl.className = 'process-box running';
      cpuProcessEl.style.borderColor = getProcColor(cpu.pid);
      cpuProcessEl.style.background = getProcColor(cpu.pid);
      cpuProcessEl.style.color = '#fff';
      cpuProcessEl.innerHTML = `PID ${cpu.pid} Running...`;
      if (!isPaused) {
        startSpinner(cpu.pid);
      }
      cpuLabel.textContent = '';
    } else {
      cpuProcessEl.textContent = '';
      cpuProcessEl.className = '';
      cpuLabel.textContent = 'Idle';
      stopSpinner();
    }

    if (isPaused) {
      cpuLabel.textContent = 'Paused';
      stopSpinner();
    }

    updatePCB();
    sysClock.textContent = clock;
    renderInterruptQueue();
  }

  // Interrupt queueing for any process
  function queueInterrupt(type, pid) {
    interruptQueue.push({
      type,
      pid,
      priority: interruptPriority[type],
      seq: interruptSeq++
    });
    logEvent(`${type} triggered for PID ${pid}`);
    renderInterruptQueue();
    // If not already handling an interrupt, process the highest-priority one
    if (!isrActive && !interruptPending) {
      processNextInterrupt();
    }
  }

  function startSpinner(pid) {
    if (spinnerInterval) return;
    const frames = [
      `PID ${pid} Running`,
      `PID ${pid} Running.`,
      `PID ${pid} Running..`,
      `PID ${pid} Running...`
    ];
    spinnerStep = 0;
    cpuProcessEl.textContent = frames[spinnerStep];
    spinnerInterval = setInterval(() => {
      spinnerStep = (spinnerStep + 1) % frames.length;
      cpuProcessEl.textContent = frames[spinnerStep];
    }, 400);
  }
  function stopSpinner() {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
    }
  }
  function schedule() {
    if (cpu || isrActive || blockScheduling) return;
    // Only pick from Ready queue
    if (readyQ.length > 0) {
      cpu = pickNextReadyProcess();
      cpu.state = 'Running';
      cpu.location = 'CPU';
      quantumUsed = 0;
      render();
      startQuantumTimer();
      logEvent(`Process PID ${cpu.pid} scheduled to CPU`);
    }
  }

  function startQuantumTimer() {
    // Quantum is enforced by tick-count (quantumUsed); timer-based preemption disabled.
    if (quantumTimer) clearTimeout(quantumTimer);
    quantumTimer = null;
    // still refresh quantum from input
    if (quantumInput && !isNaN(parseInt(quantumInput.value, 10))) {
      quantum = parseInt(quantumInput.value, 10);
    }
    if (getSelectedAlgo() !== 'RR') {
      quantumUsed = 0;
    }
  }
  function tick() {
    if (isPaused) return;
    if (!isrActive && !interruptPending) {
      if (interruptDeferred) {
        interruptDeferred = false;
        processNextInterrupt();
      } else if (!cpu && interruptQueue.length > 0) {
        processNextInterrupt();
      } else if (!cpu && !blockScheduling && readyQ.length > 0) {
        schedule();
      }
    }
    clock++;
    const algo = getSelectedAlgo();
    if (sysClock) {
      sysClock.textContent = clock;
    }

    // Execute instruction
    if (cpu && !isrActive && !interruptPending) {
      cpu.pc++;
      if (algo === 'RR') {
        quantumUsed++;
      }
      logEvent(`PID ${cpu.pid} executed, PC=${cpu.pc}`);
      render();

      // Process finished
      if (cpu.pc >= cpu.length) {
        cpu.state = 'Finished';
        cpu.location = 'Finished';
        finishedQ.push(cpu);
        logEvent(`PID ${cpu.pid} finished`);
        showFinishPopup(cpu.pid);
        cpu = null;
        render();
        return;
      }

      // Quantum expired (RR only)
      if (algo === 'RR' && quantumUsed >= quantum) {
        cpu.state = 'Ready';
        cpu.location = 'Ready';
        readyQ.push(cpu);
        logEvent(`Quantum expired for PID ${cpu.pid}, preempted to Ready`);
        cpu = null;
        render();
        schedule();
        return;
      }

      if (algo === 'SRTF' || algo === 'PRIORITY') {
        maybePreempt();
        if (!cpu) {
          return;
        }
      }
    }

    // If CPU is idle, try scheduling from Ready
    if (!cpu && !isrActive && !blockScheduling && readyQ.length > 0) {
      schedule();
    }
  }

  function startClock() {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(() => {
      tick();
    }, tickIntervalMs);
  }

  function pauseSimulation() {
    if (isPaused) return;
    isPaused = true;
    pauseAllTimeouts();
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    stopSpinner();
    render();
    logEvent('Simulation paused');
  }

  function resumeSimulation() {
    if (!isPaused) return;
    isPaused = false;
    resumeAllTimeouts();
    startClock();
    if (cpu && !isrActive && !interruptPending) {
      startSpinner(cpu.pid);
    }
    render();
    logEvent('Simulation resumed');
  }
  function showMessage(msg) {
    let msgBox = document.getElementById('msgBox');
    if (!msgBox) {
      msgBox = document.createElement('div');
      msgBox.id = 'msgBox';
      msgBox.style.position = 'fixed';
      msgBox.style.top = '24px';
      msgBox.style.left = '50%';
      msgBox.style.transform = 'translateX(-50%)';
      msgBox.style.background = '#f59e42';
      msgBox.style.color = '#222';
      msgBox.style.padding = '12px 28px';
      msgBox.style.borderRadius = '8px';
      msgBox.style.fontWeight = 'bold';
      msgBox.style.fontSize = '1.1rem';
      msgBox.style.zIndex = 1000;
      document.body.appendChild(msgBox);
    }
    msgBox.textContent = msg;
    msgBox.style.display = 'block';
    setPausableTimeout(() => { msgBox.style.display = 'none'; }, 1800);
  }
  function ensureFinishOverlay() {
    let overlay = document.getElementById('finishOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'finishOverlay';
    overlay.style.position = 'fixed';
    overlay.style.top = 0;
    overlay.style.left = 0;
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.55)';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = 2000;

    const box = document.createElement('div');
    box.id = 'finishBox';
    box.style.background = '#0f172a';
    box.style.color = '#67e8f9';
    box.style.border = '1px solid #38bdf8';
    box.style.boxShadow = '0 0 16px #38bdf866';
    box.style.padding = '26px 40px';
    box.style.borderRadius = '14px';
    box.style.fontSize = '1.1em';
    box.style.fontWeight = '500';
    box.style.boxShadow = '0 12px 40px rgba(0,0,0,0.45)';
    box.style.textAlign = 'center';

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return overlay;
  }

  function showFinishPopup(pid) {
    const overlay = ensureFinishOverlay();
    overlay.querySelector('#finishBox').textContent =
      `Process PID ${pid} has FINISHED`;

    overlay.style.display = 'flex';
    speak(`Process ${pid} is finished`);

    // Auto close after 2 seconds
    setPausableTimeout(() => {
      overlay.style.display = 'none';
    }, 2000);
  }

  function ensureInterruptOverlay() {
    let overlay = document.getElementById('interruptOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'interruptOverlay';
    overlay.style.position = 'fixed';
    overlay.style.top = 0;
    overlay.style.left = 0;
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.45)';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = 2000;

    const box = document.createElement('div');
    box.id = 'interruptBox';
    box.style.background = '#111827';
    box.style.color = '#fde68a';
    box.style.border = '1px solid #f59e42';
    box.style.boxShadow = '0 0 16px #f59e4266';
    box.style.padding = '28px 44px';
    box.style.borderRadius = '12px';
    box.style.fontSize = '1.15em';
    box.style.fontWeight = '600';
    box.style.textAlign = 'center';
    box.style.minWidth = '320px';

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return overlay;
  }

  function showInterruptPopup() {
    const overlay = ensureInterruptOverlay();
    overlay.querySelector('#interruptBox').innerHTML = 'Interrupt handled<br>successfully';
    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
      speak('Interrupt handled successfully');
    });

    setPausableTimeout(() => {
      overlay.style.display = 'none';
    }, 1700);
  }

  function shouldShowInterruptPopup() {
    return interruptQueue.length === 0 && !interruptPending && !isrActive;
  }

  function triggerInterrupt() {
    // Get selected interrupt type
    const typeSel = document.getElementById('interruptType');
    const type = typeSel ? typeSel.value : 'I/O Interrupt';
    // Queue interrupt regardless of CPU state
    interruptQueue.push({ type, priority: interruptPriority[type], seq: interruptSeq++ });
    logEvent(`${type} triggered${cpu ? ` for PID ${cpu.pid}` : ' while CPU idle'}`);
    renderInterruptQueue();
    if (interruptQueue.length > 1) {
      const ordered = interruptQueue
        .slice()
        .sort((a, b) => b.priority - a.priority || a.seq - b.seq);
      const top = ordered[0];
      const next = ordered[1];
      if (next && top.priority > next.priority) {
        showMessage(`${top.type} handled before ${next.type} (higher priority)`);
      }
    }
    // If CPU is idle, handle immediately; otherwise defer until current tick completes
    if (!cpu && !isrActive && !interruptPending) {
      processNextInterrupt();
    } else {
      interruptDeferred = true;
      blockScheduling = true;
    }
  }

  function processNextInterrupt() {
    if (interruptQueue.length === 0 || isrActive) return;
    // Pick highest-priority interrupt (tie-break by arrival order)
    const ordered = interruptQueue
      .slice()
      .sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    const next = ordered.shift();
    interruptQueue = ordered;
    const queueFactor = interruptQueue.length;
    const multiFactor = queueFactor > 0 ? 1.4 : 1;
    const arrowDelay = (1000 + queueFactor * 250) * multiFactor * isrDelayFactor;
    const powerCutDelay = (900 + queueFactor * 200) * multiFactor * isrDelayFactor;
    lastInterruptType = next.type;
    interruptPending = true;
    blockScheduling = true;
    render();
    // Show arrow
    interruptArrow.style.display = 'block';
    setPausableTimeout(() => {
      interruptArrow.style.display = 'none';
      if (lastInterruptType === 'Power Cut') {
        setPausableTimeout(() => {
          // Preempt and move to end of Ready
          if (cpu) {
            cpu.state = 'Ready';
            cpu.location = 'Ready';
            readyQ.push(cpu);
            logEvent(`${lastInterruptType}: PID ${cpu.pid} preempted to Ready`);
            cpu = null;
            render();
          } else {
            logEvent(`${lastInterruptType}: handled while CPU idle`);
            render();
          }
          interruptPending = false;
          blockScheduling = false;
          if (shouldShowInterruptPopup()) {
            showInterruptPopup();
          }
          // After handling, check for more interrupts
          processNextInterrupt();
        }, powerCutDelay);
      } else if (lastInterruptType === 'I/O Interrupt' || lastInterruptType === 'Device Interrupt' || lastInterruptType === 'Mouse Interrupt' || lastInterruptType === 'Timer Interrupt') {
        runISR();
      }
    }, arrowDelay);
  }
  function runISR() {
    isrActive = true;
    logEvent(`ISR started for ${lastInterruptType}`);
    render();
    const queueFactor = interruptQueue.length;
    const multiFactor = queueFactor > 0 ? 1.4 : 1;
    const stepDelay = (1100 + queueFactor * 200) * multiFactor * isrDelayFactor;
    const ioDelay = (1400 + queueFactor * 200) * multiFactor * isrDelayFactor;
    const finishDelay = (600 + queueFactor * 120) * multiFactor * isrDelayFactor;
    const isIO = lastInterruptType === 'I/O Interrupt';
    const steps = isIO
      ? [
          {
            text: () => `${lastInterruptType} received`,
            delay: stepDelay
          },
          {
            text: () => (cpu && cpu.state === 'Running' ? 'Context saved (move to Waiting)' : 'No running process to save'),
            delay: stepDelay,
            action: () => {
              if (cpu && cpu.state === 'Running') {
                logEvent(`PID ${cpu.pid} context saved, moved to Waiting`);
                quantumUsed = 0;
                cpu.state = 'Waiting';
                cpu.location = 'Waiting';
                waitingQ.push(cpu);
                cpu = null;
                render();
              }
            }
          },
          {
            text: () => (waitingQ.length > 0 ? `${lastInterruptType} complete (move to Ready)` : `${lastInterruptType} complete (no waiting process)`),
            delay: ioDelay,
            action: () => {
              // Simulate I/O completion: move first waiting to ready (at tail)
              if (waitingQ.length > 0) {
                const p = waitingQ.shift();
                p.state = 'Ready';
                p.location = 'Ready';
                readyQ.push(p); // tail => preserves RR order
                logEvent(`PID ${p.pid} I/O complete, moved to Ready`);
                render();
                maybePreempt();
              } else {
                logEvent('I/O complete with no waiting process');
              }
            }
          },
          {
            text: () => 'Interrupt completed',
            delay: stepDelay
          }
        ]
      : [
          {
            text: () => `${lastInterruptType} received`,
            delay: stepDelay
          },
          {
            text: () => (cpu && cpu.state === 'Running' ? 'Context saved (move to Ready)' : 'No running process to save'),
            delay: stepDelay,
            action: () => {
              if (cpu && cpu.state === 'Running') {
                logEvent(`PID ${cpu.pid} context saved, moved to Ready`);
                quantumUsed = 0;
                cpu.state = 'Ready';
                cpu.location = 'Ready';
                readyQ.push(cpu);
                cpu = null;
                render();
              }
            }
          },
          {
            text: () => 'Interrupt completed',
            delay: stepDelay
          }
        ];
    isrSteps.innerHTML = '';
    let idx = 0;
    function nextStep() {
      if (idx > 0) isrSteps.children[idx - 1].classList.remove('highlight');
      if (idx < steps.length) {
        const step = steps[idx];
        const li = document.createElement('li');
        li.textContent = typeof step.text === 'function' ? step.text() : step.text;
        li.classList.add('highlight');
        isrSteps.appendChild(li);
        if (step.action) step.action();
        idx++;
        setPausableTimeout(nextStep, step.delay);
      } else {
        isrSteps.innerHTML = '';
        isrActive = false;
        interruptPending = false;
        blockScheduling = false;
        logEvent('ISR completed');
        render();
        if (shouldShowInterruptPopup()) {
          showInterruptPopup();
        }
        setPausableTimeout(() => {
          processNextInterrupt();
          schedule();
        }, finishDelay);
      }
    }
    nextStep();
  }
  document.getElementById('createProc').onclick = function() {
    const lenInput = document.getElementById('procLength');
    const prioInput = document.getElementById('procPriority');
    let len = parseInt(lenInput.value, 10);
    if (isNaN(len) || len < 1) len = 6;
    let prio = prioInput ? parseInt(prioInput.value, 10) : 3;
    if (isNaN(prio) || prio < 1) {
      showMessage('Priority cannot be less than 1');
      return;
    }
    if (prio > 5) prio = 5;
    const p = {
      pid: pidCounter++,
      pc: 0,
      length: len,
      priority: prio,
      state: 'New',
      location: 'PCB'
    };
    if (schedulerStarted) {
      addProcessToReady(p);
    } else {
      pendingQ.push(p);
    }
    if (getSelectedAlgo() === 'PRIORITY') {
      logEvent(`Process created: PID ${p.pid}, length ${p.length}, priority ${p.priority}`);
    } else {
      logEvent(`Process created: PID ${p.pid}, length ${p.length}`);
    }
    render();
    if (schedulerStarted) {
      if (!cpu && !isrActive && !interruptPending && !blockScheduling) {
        schedule();
      } else if (getSelectedAlgo() === 'SRTF' || getSelectedAlgo() === 'PRIORITY') {
        maybePreempt();
      }
    }
    // Do NOT call schedule here; let the clock tick or ISR completion trigger scheduling
  };
      // Tab switching logic
      if (tabInterrupt && tabMonitor && tabContentInterrupt && tabContentMonitor) {
        tabInterrupt.onclick = function() {
          tabInterrupt.classList.add('active');
          tabMonitor.classList.remove('active');
          tabContentInterrupt.style.display = '';
          tabContentMonitor.style.display = 'none';
        };
        tabMonitor.onclick = function() {
          tabMonitor.classList.add('active');
          tabInterrupt.classList.remove('active');
          tabContentInterrupt.style.display = 'none';
          tabContentMonitor.style.display = '';
        };
      }

    if (scheduleAlgo && quantumInput) {
      const updateQuantumState = () => {
        const isRR = scheduleAlgo.value === 'RR';
        quantumInput.disabled = !isRR;
        if (timesliceLabel) {
          timesliceLabel.style.display = isRR ? '' : 'none';
        }
        if (procPriority && procPriority.parentElement) {
          procPriority.parentElement.style.display = scheduleAlgo.value === 'PRIORITY' ? '' : 'none';
          procPriority.disabled = scheduleAlgo.value !== 'PRIORITY';
        }

        if (startScheduler) {
          startScheduler.onclick = function() {
            if (pendingQ.length === 0) {
              showMessage('No new processes to start');
              return;
            }
            schedulerStarted = true;
            buildReadyFromPending();
            logEvent('All new processes moved to Ready');
            render();
            setPausableTimeout(() => {
              schedule();
            }, 2200);
          };
        }
        const prioCells = document.querySelectorAll('.prio-col');
        prioCells.forEach(cell => {
          cell.style.display = scheduleAlgo.value === 'PRIORITY' ? '' : 'none';
        });
      };
      scheduleAlgo.onchange = function() {
        updateQuantumState();
        render();
        maybePreempt();
      };
      updateQuantumState();
    }
  document.getElementById('genInterrupt').onclick = function() {
    triggerInterrupt();
  };

  if (pauseToggle) {
    pauseToggle.onclick = function() {
      if (isPaused) {
        pauseToggle.textContent = 'Pause';
        resumeSimulation();
      } else {
        pauseToggle.textContent = 'Resume';
        pauseSimulation();
      }
    };
  }

  // Init
  render();
  startClock();

})();
