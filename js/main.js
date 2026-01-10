// Conversion constants and helpers (DRY)
export const KMH_TO_MS = 1000 / 3600;
export const MS_TO_KMH = 3600 / 1000;
export function kmhToMs(kmh) { return kmh * KMH_TO_MS; }
export function msToKmh(ms) { return ms * MS_TO_KMH; }

// Physics-based power-to-speed conversion
// Returns speed in m/s for given power (watts) and parameters
export function powerToSpeed({
  power,
  cda = 0.38, // drag area (m^2) - slightly higher for realism
  crr = 0.006, // rolling resistance coefficient - slightly higher for realism
  mass = 70, // total mass (kg)
  airDensity = 1.225, // kg/m^3
  slope = 0 // road grade (decimal)
} = {}) {
  // Constants
  const g = 9.8067; // gravity
  // Use a root-finding approach for cubic equation: P = a*v^3 + b*v
  // a = 0.5 * airDensity * cda
  // b = crr * mass * g + mass * g * Math.sin(Math.atan(slope))
  const a = 0.5 * airDensity * cda;
  const b = crr * mass * g + mass * g * Math.sin(Math.atan(slope));
  // Use Newton-Raphson to solve for v
  let v = 8; // initial guess (m/s)
  for (let i = 0; i < 20; i++) {
    const f = a * v * v * v + b * v - power;
    const df = 3 * a * v * v + b;
    v = v - f / df;
    if (v < 0) v = 0.1; // prevent negative speeds
  }   
  return msToKmh(v);
}

// main.js: App entry point and state management
import { TrainerBluetooth } from './bluetooth.js';
import { ZlowScene } from './scene.js';
import { HUD } from './hud.js';
import { Strava } from './strava.js';
import { WorkoutManager, WorkoutModal } from './workout.js';
import { MultiplayerClient, MultiplayerModal } from './multiplayer.js';

// Exported function to initialize app (for browser and test)
export function initZlowApp({
  getElement = (id) => document.getElementById(id),
  requestAnimationFrameFn = window.requestAnimationFrame,
  getAuthToken = () => localStorage.getItem('zlow_token'),
  apiBase = 'http://localhost:8080'
} = {}) {
  // Ensure we have an auth token, fetch one if needed
  let tokenInitialized = false;
  let cachedToken = getAuthToken();
  
  if (!cachedToken) {
    console.log('[Zlow] No auth token found in localStorage. Fetching test token from API...');
    tokenInitialized = false;
    fetch(`${apiBase}/auth/test-token?t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        if (data.token) {
          localStorage.setItem('zlow_token', data.token);
          cachedToken = data.token;
          tokenInitialized = true;
          console.log('[Zlow] Test token saved to localStorage and ready for use');
        }
      })
      .catch(err => {
        console.error('[Zlow] Failed to fetch test token:', err);
        tokenInitialized = true; // Mark as initialized even on error so we don't retry forever
      });
  } else {
    tokenInitialized = true;
    console.log('[Zlow] Auth token found in localStorage');
  }

  // Create a function that returns the current token (from cache or storage)
  // This function also refreshes the token if it appears to be expired
  const getCurrentAuthToken = () => {
    const token = localStorage.getItem('zlow_token') || cachedToken;
    
    if (token) {
      // Quick check: if token looks like JWT, try to parse the payload to check expiry
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          const expiresAt = payload.exp * 1000; // Convert to milliseconds
          const now = Date.now();
          
          if (now > expiresAt) {
            console.warn('[Zlow] Token has expired. Fetching a fresh one...');
            // Token expired, fetch a new one
            fetch(`${apiBase}/auth/test-token?t=${Date.now()}`)
              .then(res => res.json())
              .then(data => {
                if (data.token) {
                  localStorage.setItem('zlow_token', data.token);
                  console.log('[Zlow] Fresh token saved to localStorage');
                }
              })
              .catch(err => console.error('[Zlow] Failed to fetch fresh token:', err));
          }
        }
      } catch (e) {
        // If parsing fails, just use the token as-is
      }
    }
    
    return token;
  };

  const trainer = new TrainerBluetooth();
  const pacerSpeedInput = getElement('pacer-speed');
  const scene = new ZlowScene(Number(pacerSpeedInput.value), { getElement });
  pacerSpeedInput.addEventListener('input', () => {
    const val = Number(pacerSpeedInput.value);
    scene.setPacerSpeed(val);
  });
  const hud = new HUD({ getElement });
  const strava = new Strava();

  // Initialize workout system
  const workoutManager = new WorkoutManager({
    apiBase: 'http://localhost:8080',
    getToken: getAuthToken
  });

  const workoutModal = new WorkoutModal({
    workoutManager,
    getElement,
    onWorkoutSelected: (workout) => {
      // Execute selected workout
      const program = workoutManager.getWorkoutProgram(workout.id);
      scene.setWorkoutProgram(program);
      console.log('Starting workout:', workout.name);
    }
  });

  // Make workout modal globally accessible
  window.workoutModalInstance = workoutModal;

  // Initialize multiplayer system
  let multiplayerClient = null;
  const multiplayerModal = new MultiplayerModal({
    getElement,
    getToken: getCurrentAuthToken,
    apiBase: apiBase,
    onJoinRoom: ({ roomId, lobbyName }) => {
      console.log(`[Main] onJoinRoom called with roomId=${roomId}, lobbyName=${lobbyName}`);
      console.log(`Joined multiplayer lobby: ${lobbyName} (${roomId})`);
      
      // Show multiplayer panel
      const mpPanel = getElement('multiplayer-panel');
      if (mpPanel) mpPanel.style.display = 'block';
      
      // Get the client that was created in the modal
      if (multiplayerModal.multiplayerClient) {
        multiplayerClient = multiplayerModal.multiplayerClient;
        
        // Update status
        const statusEl = getElement('multiplayer-status');
        if (statusEl) {
          statusEl.textContent = `Connected to: ${roomId}`;
        }
        
        // Setup listener for chat messages from other riders
        multiplayerClient.on('message', (data) => {
          console.log('[Main] Received message:', data);
          const chatEl = getElement('chat-messages');
          if (chatEl) {
            const msgDiv = document.createElement('div');
            msgDiv.style.color = '#fff';
            // Handle both formats: {content: {message: "..."}} and {content: "..."}
            const message = typeof data.content === 'string' ? data.content : (data.content?.message || 'Message');
            msgDiv.textContent = `Other: ${message}`;
            chatEl.appendChild(msgDiv);
            chatEl.scrollTop = chatEl.scrollHeight;
          }
        });
        console.log('[Main] Message event listener registered');
        
        // Setup listener for state updates from other riders
        multiplayerClient.on('state_update', (data) => {
          console.log('Received state update from rider:', data);
          
          // Update riders list
          const ridersList = getElement('riders-list');
          if (ridersList && data.content) {
            // Just show summary (in real app would track multiple riders)
            const speed = Math.round(data.content.speed * 10) / 10;
            const power = Math.round(data.content.power);
            ridersList.innerHTML = `Other rider: ${power}W @ ${speed} km/h`;
          }
        });
        
        // Chat send button
        const chatInput = getElement('chat-input');
        const chatSendBtn = getElement('chat-send-btn');
        console.log('[Main] Chat elements found - chatInput:', !!chatInput, 'chatSendBtn:', !!chatSendBtn);
        if (chatSendBtn && chatInput) {
          chatSendBtn.addEventListener('click', () => {
            const message = chatInput.value.trim();
            console.log('[Main] Chat send clicked. Message:', message, 'Multiplayer client:', multiplayerClient);
            if (message && multiplayerClient) {
              console.log('[Main] Calling sendChat with message:', message);
              multiplayerClient.sendChat(message);
              chatInput.value = '';
              
              // Show own message in chat
              const chatEl = getElement('chat-messages');
              if (chatEl) {
                const msgDiv = document.createElement('div');
                msgDiv.style.color = '#90ee90';
                msgDiv.textContent = `You: ${message}`;
                chatEl.appendChild(msgDiv);
                chatEl.scrollTop = chatEl.scrollHeight;
              }
            }
          });
          
          // Send on Enter key
          chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') chatSendBtn.click();
          });
        }

        // Send state updates periodically
        const stateInterval = setInterval(() => {
          if (multiplayerClient && multiplayerClient.isConnected) {
            multiplayerClient.sendState({
              power: riderState.power,
              speed: riderState.speed,
              distance: rideHistory.length > 0 ? rideHistory[rideHistory.length - 1].distance : 0,
              time: Date.now() - historyStartTime
            });
          } else {
            clearInterval(stateInterval);
          }
        }, 1000);
      }
    }
  });

  // Make multiplayer modal globally accessible
  window.multiplayerModalInstance = multiplayerModal;

  // Add workout button to HUD
  const hudEl = getElement('hud');
  if (hudEl && !getElement('workout-btn')) {
    const workoutBtn = document.createElement('button');
    workoutBtn.id = 'workout-btn';
    workoutBtn.textContent = '💪 Workouts';
    workoutBtn.style.display = 'block';
    workoutBtn.style.marginBottom = '10px';
    workoutBtn.addEventListener('click', () => workoutModal.toggle());
    hudEl.insertBefore(workoutBtn, getElement('connect-btn'));
  }

  // Add multiplayer button to HUD
  if (hudEl && !getElement('multiplayer-btn')) {
    const multiplayerBtn = document.createElement('button');
    multiplayerBtn.id = 'multiplayer-btn';
    multiplayerBtn.textContent = '🌐 Multiplayer';
    multiplayerBtn.style.display = 'block';
    multiplayerBtn.style.marginBottom = '10px';
    multiplayerBtn.addEventListener('click', () => multiplayerModal.toggle());
    hudEl.insertBefore(multiplayerBtn, getElement('connect-btn'));
  }

  let riderState = { power: 0, speed: 0 };
  let rideHistory = [];
  let historyStartTime = Date.now();
  let lastHistorySecond = null;
  let pacerStarted = false;
  let lastTime = Date.now();

  let keyboardMode = false;
  let keyboardSpeed = kmhToMs(100);
  let keyboardHalfSpeed = kmhToMs(50);
  const keyboardBtn = getElement('keyboard-btn');
  keyboardBtn.addEventListener('click', () => {
    keyboardMode = !keyboardMode;
    keyboardBtn.textContent = keyboardMode ? 'Keyboard Mode: ON' : 'Keyboard Mode';
    if (!keyboardMode) {
      riderState.speed = 0;
    }
  });

  let wKeyDown = false;
  let sKeyDown = false;
  document.addEventListener('keydown', (e) => {
    if (!keyboardMode) return;
    const key = e.key.toLowerCase();
    if (key === 'w' && !wKeyDown) {
      wKeyDown = true;
      riderState.speed = keyboardSpeed;
      if (!pacerStarted) { scene.activatePacer(); pacerStarted = true; }
    } else if (key === 's' && !sKeyDown) {
      sKeyDown = true;
      riderState.speed = keyboardHalfSpeed;
      if (!pacerStarted) { scene.activatePacer(); pacerStarted = true; }
    }
  });
  document.addEventListener('keyup', (e) => {
    if (!keyboardMode) return;
    const key = e.key.toLowerCase();
    if (key === 'w') {
      wKeyDown = false;
      riderState.speed = sKeyDown ? keyboardHalfSpeed : 0;
    } else if (key === 's') {
      sKeyDown = false;
      riderState.speed = wKeyDown ? keyboardSpeed : 0;
    }
  });

  const connectBtn = getElement('connect-btn');
  connectBtn.addEventListener('click', async () => {
    const ok = await trainer.connect();
    if (ok) connectBtn.disabled = true;
  });

  trainer.onData = data => {
    if (!keyboardMode) {
      let speed = 0;
      if (typeof data.power === 'number' && data.power > 0) {
        speed = powerToSpeed({ power: data.power });
      }
      riderState = { ...riderState, power: data.power, speed };
      if (speed > 0 && !pacerStarted) {
        scene.activatePacer();
        pacerStarted = true;
      }
    } else {
      riderState = { ...riderState, power: data.power };
    }
  };

  const stravaBtn = getElement('strava-btn');
  let stravaBtnEnabled = false;
  function loop() {
    const now = Date.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    scene.update(riderState.speed || 0, dt);
    hud.update(riderState, dt);
    const thisSecond = Math.floor((now - historyStartTime) / 1000);
    if (lastHistorySecond !== thisSecond) {
      rideHistory.push({
        time: now,
        power: riderState.power || 0,
        speed: riderState.speed || 0,
        distance: parseFloat(getElement('distance').textContent) || 0
      });
      lastHistorySecond = thisSecond;
    }
    requestAnimationFrameFn(loop);
  }
  loop();

  getElement('gpx-btn').addEventListener('click', () => {
    if (rideHistory.length < 2) {
      alert('Not enough data to export.');
      return;
    }
    const startTime = new Date(rideHistory[0].time);
    let tcx = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    tcx += `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">\n`;
    tcx += `  <Activities>\n    <Activity Sport="Biking">\n      <Id>${startTime.toISOString()}</Id>\n      <Lap StartTime="${startTime.toISOString()}">\n        <TotalTimeSeconds>${Math.floor((rideHistory[rideHistory.length-1].time - rideHistory[0].time)/1000)}</TotalTimeSeconds>\n        <DistanceMeters>${(rideHistory[rideHistory.length-1].distance*1000).toFixed(1)}<\/DistanceMeters>\n        <Intensity>Active<\/Intensity>\n        <TriggerMethod>Manual<\/TriggerMethod>\n        <Track>\n`;
    for (let i = 0; i < rideHistory.length; i++) {
      const pt = rideHistory[i];
      const t = new Date(pt.time).toISOString();
      const lat = 33.6 + (pt.distance / (rideHistory[rideHistory.length-1].distance || 1)) * 0.009;
      const lon = -111.7;
      tcx += `          <Trackpoint>\n`;
      tcx += `            <Time>${t}</Time>\n`;
      tcx += `            <Position><LatitudeDegrees>${lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${lon.toFixed(6)}</LongitudeDegrees></Position>\n`;
      tcx += `            <DistanceMeters>${(pt.distance*1000).toFixed(1)}</DistanceMeters>\n`;
      tcx += `            <Cadence>0</Cadence>\n`;
      tcx += `            <Extensions>\n`;
      tcx += `              <ns3:TPX xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">\n`;
      tcx += `                <ns3:Watts>${Math.round(pt.power)}</ns3:Watts>\n`;
      tcx += `                <ns3:Speed>${kmhToMs(pt.speed).toFixed(3)}</ns3:Speed>\n`;
      tcx += `              </ns3:TPX>\n`;
      tcx += `            </Extensions>\n`;
      tcx += `          </Trackpoint>\n`;
    }
    tcx += `        </Track>\n      </Lap>\n    </Activity>\n  </Activities>\n</TrainingCenterDatabase>\n`;
    const blob = new Blob([tcx], {type: 'application/vnd.garmin.tcx+xml'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zlow-ride.tcx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    rideHistory = [];
    historyStartTime = Date.now();
    lastHistorySecond = null;
  });

  const pacerSyncBtn = getElement('pacer-sync-btn');
  pacerSyncBtn.addEventListener('click', () => {
    // Set pacer's z to rider's z
    if (scene && scene.avatar && scene.pacer) {
      const riderPos = scene.avatar.getAttribute('position');
      scene.pacerPos.z = riderPos.z;
      scene.pacer.setAttribute('position', `${scene.pacerPos.x} ${scene.pacerPos.y} ${scene.pacerPos.z}`);
    }
  });

  // For testing: export some internals
  return {
    trainer,
    scene,
    hud,
    strava,
    getRiderState: () => riderState,
    getRideHistory: () => rideHistory,
    setRiderState: (state) => { riderState = state; },
    setKeyboardMode: (mode) => { keyboardMode = mode; },
    getKeyboardMode: () => keyboardMode,
    setPacerStarted: (val) => { pacerStarted = val; },
    getPacerStarted: () => pacerStarted,
    setLastTime: (val) => { lastTime = val; },
    getLastTime: () => lastTime,
    setHistoryStartTime: (val) => { historyStartTime = val; },
    getHistoryStartTime: () => historyStartTime,
    setLastHistorySecond: (val) => { lastHistorySecond = val; },
    getLastHistorySecond: () => lastHistorySecond,
  };
}

// For browser usage
if (typeof window !== 'undefined') {
  window.initZlowApp = initZlowApp;
}
