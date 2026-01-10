/**
 * Workout management and modal UI
 * Handles loading, creating, and executing custom workouts
 */

export class WorkoutManager {
  constructor({ apiBase = 'http://localhost:8080', getToken = () => null } = {}) {
    this.apiBase = apiBase;
    this.getToken = getToken;
    this.workouts = [];
    this.currentWorkout = null;
    this.isModalOpen = false;
  }

  /**
   * Load workouts from API
   */
  async loadWorkouts() {
    const token = this.getToken();
    if (!token) {
      console.warn('No token available, cannot load workouts');
      return [];
    }

    try {
      const res = await fetch(`${this.apiBase}/workouts`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        console.error('Failed to load workouts:', res.status);
        return [];
      }

      this.workouts = await res.json();
      return this.workouts || [];
    } catch (err) {
      console.error('Error loading workouts:', err);
      return [];
    }
  }

  /**
   * Create a new workout
   */
  async createWorkout(name, segments) {
    const token = this.getToken();
    if (!token) {
      throw new Error('No token available');
    }

    try {
      const res = await fetch(`${this.apiBase}/workouts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, segments })
      });

      if (!res.ok) {
        throw new Error(`Failed to create workout: ${res.status}`);
      }

      const workout = await res.json();
      this.workouts.push(workout);
      return workout;
    } catch (err) {
      console.error('Error creating workout:', err);
      throw err;
    }
  }

  /**
   * Delete a workout
   */
  async deleteWorkout(workoutId) {
    const token = this.getToken();
    if (!token) {
      throw new Error('No token available');
    }

    try {
      const res = await fetch(`${this.apiBase}/workouts/${workoutId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        throw new Error(`Failed to delete workout: ${res.status}`);
      }

      this.workouts = this.workouts.filter(w => w.id !== workoutId);
      return true;
    } catch (err) {
      console.error('Error deleting workout:', err);
      throw err;
    }
  }

  /**
   * Get workout as power array for the simulation
   * Returns array of [power, duration] segments
   */
  getWorkoutProgram(workoutId) {
    const workout = this.workouts.find(w => w.id === workoutId);
    if (!workout || !workout.segments) return [];

    return workout.segments
      .sort((a, b) => a.order - b.order)
      .map(seg => ({ power: seg.power, duration: seg.duration }));
  }
}

/**
 * Workout Modal UI Component
 */
export class WorkoutModal {
  constructor({
    workoutManager = null,
    getElement = (id) => document.getElementById(id),
    onWorkoutSelected = () => {}
  } = {}) {
    this.workoutManager = workoutManager;
    this.getElement = getElement;
    this.onWorkoutSelected = onWorkoutSelected;
    this.isOpen = false;
    this.mode = 'list'; // 'list' or 'create'
    this.segmentCount = 1;

    this.initModal();
  }

  initModal() {
    // Create modal HTML
    const modalHTML = `
      <div id="workout-modal" class="workout-modal" style="display: none;">
        <div class="workout-modal-content">
          <!-- Header -->
          <div class="workout-modal-header">
            <h2>Workouts</h2>
            <button id="workout-modal-close" class="workout-modal-close">&times;</button>
          </div>

          <!-- Tab Navigation -->
          <div class="workout-modal-tabs">
            <button class="workout-tab-btn active" data-tab="list">My Workouts</button>
            <button class="workout-tab-btn" data-tab="create">Create New</button>
          </div>

          <!-- List Tab -->
          <div id="workout-list-tab" class="workout-tab-content active">
            <div id="workout-list" class="workout-list"></div>
          </div>

          <!-- Create Tab -->
          <div id="workout-create-tab" class="workout-tab-content" style="display: none;">
            <div class="form-group">
              <label>Workout Name</label>
              <input type="text" id="workout-name" placeholder="e.g., FTP Builder" class="workout-input">
            </div>

            <div id="segments-container" class="segments-container"></div>

            <button id="add-segment-btn" class="workout-btn secondary">+ Add Segment</button>

            <div style="margin-top: 20px; display: flex; gap: 10px;">
              <button id="create-workout-btn" class="workout-btn primary">Create Workout</button>
              <button id="cancel-create-btn" class="workout-btn secondary">Cancel</button>
            </div>
          </div>

          <!-- Visualization -->
          <div id="workout-preview" class="workout-preview" style="margin-top: 20px; display: none;">
            <h3>Preview</h3>
            <canvas id="workout-canvas" width="400" height="150"></canvas>
          </div>
        </div>
      </div>
    `;

    // Inject modal into page
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Get modal element and attach listeners
    this.modal = this.getElement('workout-modal');
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Close button
    this.getElement('workout-modal-close').addEventListener('click', () => this.close());

    // Tab buttons
    document.querySelectorAll('.workout-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });

    // Add segment button
    this.getElement('add-segment-btn').addEventListener('click', () => this.addSegment());

    // Create button
    this.getElement('create-workout-btn').addEventListener('click', () => this.createWorkout());

    // Cancel button
    this.getElement('cancel-create-btn').addEventListener('click', () => {
      this.mode = 'list';
      this.switchTab('list');
    });

    // Close on background click
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
  }

  switchTab(tabName) {
    // Update active tab button
    document.querySelectorAll('.workout-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update active tab content
    const listTab = this.getElement('workout-list-tab');
    const createTab = this.getElement('workout-create-tab');

    if (tabName === 'list') {
      listTab.style.display = 'block';
      createTab.style.display = 'none';
      this.mode = 'list';
      this.refreshWorkoutList();
    } else {
      listTab.style.display = 'none';
      createTab.style.display = 'block';
      this.mode = 'create';
      if (this.segmentCount === 0) {
        this.segmentCount = 1;
        this.addSegment();
      }
    }
  }

  async refreshWorkoutList() {
    if (!this.workoutManager) return;

    const workouts = await this.workoutManager.loadWorkouts();
    const listContainer = this.getElement('workout-list');

    if (workouts.length === 0) {
      listContainer.innerHTML = '<p style="color: #999; text-align: center;">No workouts yet. Create one!</p>';
      return;
    }

    let html = '<div class="workout-items">';
    workouts.forEach(workout => {
      const totalDuration = workout.duration || 0;
      const mins = Math.floor(totalDuration / 60);
      const secs = totalDuration % 60;

      html += `
        <div class="workout-item">
          <div class="workout-item-header">
            <h4>${workout.name}</h4>
            <span class="workout-duration">${mins}:${String(secs).padStart(2, '0')}</span>
          </div>
          <div class="workout-item-segments">
            ${(workout.segments || [])
              .sort((a, b) => a.order - b.order)
              .map(seg => `<span class="segment-badge">${seg.power}W×${seg.duration}s</span>`)
              .join('')}
          </div>
          <div class="workout-item-actions">
            <button class="workout-btn-small primary" data-workout-id="${workout.id}" onclick="window.workoutModalInstance?.selectWorkout('${workout.id}')">Select</button>
            <button class="workout-btn-small secondary" data-workout-id="${workout.id}" onclick="window.workoutModalInstance?.deleteWorkout('${workout.id}')">Delete</button>
          </div>
        </div>
      `;
    });
    html += '</div>';

    listContainer.innerHTML = html;
  }

  addSegment() {
    this.segmentCount++;
    const container = this.getElement('segments-container');

    const segmentHTML = `
      <div class="segment-input" data-segment="${this.segmentCount}">
        <div style="display: flex; gap: 10px; align-items: flex-end;">
          <div style="flex: 1;">
            <label>Power (watts)</label>
            <input type="number" class="segment-power" placeholder="200" min="0" class="workout-input">
          </div>
          <div style="flex: 1;">
            <label>Duration (seconds)</label>
            <input type="number" class="segment-duration" placeholder="30" min="1" class="workout-input">
          </div>
          <button class="workout-btn-small secondary" onclick="this.parentElement.parentElement.remove()">Remove</button>
        </div>
      </div>
    `;

    container.insertAdjacentHTML('beforeend', segmentHTML);
    this.drawWorkoutPreview();
  }

  async createWorkout() {
    if (!this.workoutManager) return;

    const name = this.getElement('workout-name').value.trim();
    if (!name) {
      alert('Please enter a workout name');
      return;
    }

    const segments = [];
    document.querySelectorAll('.segment-input').forEach(el => {
      const power = parseInt(el.querySelector('.segment-power').value);
      const duration = parseInt(el.querySelector('.segment-duration').value);
      if (power > 0 && duration > 0) {
        segments.push({ power, duration });
      }
    });

    if (segments.length === 0) {
      alert('Please add at least one segment');
      return;
    }

    try {
      await this.workoutManager.createWorkout(name, segments);
      alert('Workout created!');

      // Reset form
      this.getElement('workout-name').value = '';
      document.getElementById('segments-container').innerHTML = '';
      this.segmentCount = 0;

      // Go back to list
      this.switchTab('list');
    } catch (err) {
      alert('Failed to create workout: ' + err.message);
    }
  }

  async deleteWorkout(workoutId) {
    if (!confirm('Delete this workout?')) return;

    try {
      await this.workoutManager.deleteWorkout(workoutId);
      this.refreshWorkoutList();
    } catch (err) {
      alert('Failed to delete workout: ' + err.message);
    }
  }

  selectWorkout(workoutId) {
    const workout = this.workoutManager?.workouts.find(w => w.id === workoutId);
    if (workout) {
      this.onWorkoutSelected(workout);
      this.close();
    }
  }

  drawWorkoutPreview() {
    const canvas = this.getElement('workout-canvas');
    if (!canvas || !canvas.getContext) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = 40;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);

    // Get segments
    const segments = [];
    document.querySelectorAll('.segment-input').forEach(el => {
      const power = parseInt(el.querySelector('.segment-power').value);
      const duration = parseInt(el.querySelector('.segment-duration').value);
      if (power > 0 && duration > 0) {
        segments.push({ power, duration });
      }
    });

    if (segments.length === 0) return;

    const maxPower = Math.max(...segments.map(s => s.power), 200);
    const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);

    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;
    const pixelsPerSecond = graphWidth / totalDuration;
    const pixelsPerWatt = graphHeight / maxPower;

    // Draw axes
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(padding, padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    // Draw segments
    ctx.fillStyle = '#ff6b35';
    let currentTime = 0;

    segments.forEach(seg => {
      const x1 = padding + currentTime * pixelsPerSecond;
      const x2 = padding + (currentTime + seg.duration) * pixelsPerSecond;
      const y = height - padding - seg.power * pixelsPerWatt;
      const barHeight = seg.power * pixelsPerWatt;

      ctx.fillRect(x1, y, x2 - x1, barHeight);

      currentTime += seg.duration;
    });

    // Labels
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Time (s)', width / 2, height - 10);
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Power (W)', 0, 0);
    ctx.restore();
  }

  open() {
    this.modal.style.display = 'block';
    this.isOpen = true;
    this.switchTab('list');
  }

  close() {
    this.modal.style.display = 'none';
    this.isOpen = false;
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
}
