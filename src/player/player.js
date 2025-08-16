// Configuration constants
const CONFIG = {
  streamUrl: 'http://localhost:3000/content/playlists/master_15s_segments.m3u8',
  bufferGoal: 20,                 // Target buffer length in seconds
  lowBufferThreshold: 5,          // Buffer level to trigger emergency downgrade
  fairBufferThreshold: 10,        // Buffer level for "Fair" rating
  goodBufferThreshold: 20,        // Buffer level for "Good" rating

  bufferStartOffset: 5,           // Show 5 seconds behind current position
  bufferTimelineWindow: 60,       // Buffer timeline display window in seconds

  maxLogEntries: 20,              // Maximum decision log entries
  maxDisplaySwitches: 5,          // Number of quality switches to show
  
  minStutterAdvance: 0.1,         // Min video time advance to not be considered stuttering
  expectedPlaybackRate: 0.5,       // Expected minimum playback rate (fraction of real-time)
  stutterRatings: {
    excellent: 1,                  // < 1% stutter ratio
    good: 5,                       // < 5% stutter ratio
    fair: 10                       // < 10% stutter ratio
    // Anything above 10% is "Poor"
  }
};

// DOM elements
const video = document.getElementById('video');

// Core player state
let hls;

const playerState = {
  lastUpdateTime: Date.now()
};

// ABR state
const abrState = {
  qualitySwitchHistory: [],
  decisionLog: []
};

// Stutter tracking state
const stutterState = {
  events: [],
  count: 0,
  totalTime: 0,
  playbackStartTime: 0,
  playbackTotalTime: 0,
  isStuttering: false,
  stutterStartTime: 0,
  lastPlayPosition: 0
};


// HLS Player Setup
if (Hls.isSupported()) {
    hls = new Hls({
        debug: false,                    // Set to false to reduce console noise
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: CONFIG.bufferGoal,
        maxMaxBufferLength: CONFIG.bufferGoal,
        startLevel: 0,                  // Start with lowest quality
    });

    window.hls = hls; // Make globally accessible

    hls.loadSource(CONFIG.streamUrl);
    hls.attachMedia(video);

    setupHlsEventListeners();
    setupStutterDetection();
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Fallback for Safari
    video.src = CONFIG.streamUrl;
}

// HLS Event Listeners Setup
function setupHlsEventListeners() {
    hls.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
        console.log('Manifest parsed, found ' + data.levels.length + ' quality levels');
        updateStats();
        addToDecisionLog({
            timestamp: new Date(),
            action: 'Manifest Loaded',
            details: `${data.levels.length} quality levels available`
        });
    });

    hls.on(Hls.Events.LEVEL_SWITCHING, function (event, data) {
        console.log('Level switching to: ' + data.level);
        
        const bufferLength = video.buffered.length > 0 ? 
            video.buffered.end(video.buffered.length - 1) - video.currentTime : 0;
        const bandwidth = hls.bandwidthEstimate ? hls.bandwidthEstimate / 1000 : 0;
        
        const switchInfo = {
            timestamp: Date.now(),
            level: data.level,
            resolution: hls.levels[data.level] ? `${hls.levels[data.level].width}x${hls.levels[data.level].height}` : 'Unknown',
            bitrate: hls.levels[data.level] ? hls.levels[data.level].bitrate : 0,
            bufferHealth: bufferLength,
            bandwidth: bandwidth,
            reason: determineSwitchReason(data, bufferLength, bandwidth)
        };
        
        abrState.qualitySwitchHistory.push(switchInfo);
        updateQualitySwitchDisplay();
        
        addToDecisionLog({
            timestamp: new Date(),
            action: 'Quality Switch Initiated',
            details: `To ${switchInfo.resolution} (${Math.round(switchInfo.bitrate/1000)}kbps) - ${switchInfo.reason}`
        });
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, function (event, data) {
        console.log('Level switched to: ' + data.level);
        updateCurrentQuality();
        addToDecisionLog({
            timestamp: new Date(),
            action: 'Quality Switch Complete',
            details: `Now playing ${hls.levels[data.level].width}x${hls.levels[data.level].height}`
        });
    });

    hls.on(Hls.Events.FRAG_BUFFERED, function (event, data) {
        updateBufferHealth();
        updateBufferTimeline();
    });

    hls.on(Hls.Events.ERROR, function (event, data) {
        console.error('HLS Error:', data);
        addToDecisionLog({
            timestamp: new Date(),
            action: 'Error Occurred',
            details: `${data.type}: ${data.details}`
        });
    });
}

function determineSwitchReason(data, bufferHealth, bandwidth) {
    if (!hls.levels[data.level]) return 'Unknown';
    
    const targetBitrate = hls.levels[data.level].bitrate / 1000;
    const currentBitrate = hls.currentLevel >= 0 && hls.levels[hls.currentLevel] ? 
        hls.levels[hls.currentLevel].bitrate / 1000 : 0;
    
    if (bufferHealth < CONFIG.lowBufferThreshold) 
        return 'Low buffer - emergency downgrade';
    
    if (bufferHealth > CONFIG.bufferGoal && 
        bandwidth > targetBitrate * 1.5 && 
        data.level > hls.currentLevel) 
        return 'Sufficient buffer + bandwidth - upgrade';
    
    if (bandwidth < currentBitrate * 0.8 && data.level < hls.currentLevel) 
        return 'Insufficient bandwidth - downgrade';
    
    return 'Routine optimization';
}

function updateStats() {
    if (!hls) return;
    
    // Update stats using the configured interval
    setInterval(() => {
        updateCurrentQuality();
        updateBufferHealth();
        updateBandwidth();
        updateDroppedFrames();
        updateLoadingState();
        updateBufferTimeline();
        updateABRTransparency();
        updateSwitchFrequency();
        updateStutterMetrics();
    }, 1000);
}

function updateCurrentQuality() {
    if (hls && hls.levels && hls.currentLevel >= 0) {
        const level = hls.levels[hls.currentLevel];
        document.getElementById('current-quality').textContent = 
            `${level.height}p @ ${Math.round(level.bitrate/1000)}kbps`;
    }
}

function updateBufferHealth() {
    if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const currentTime = video.currentTime;
        const bufferHealth = Math.max(0, bufferedEnd - currentTime);
        
        document.getElementById('buffer-health').textContent = `${bufferHealth.toFixed(1)}s`;
        document.getElementById('buffer-length').textContent = `Buffer: ${bufferHealth.toFixed(1)}s`;
        
        // Update buffer health indicator using configured thresholds
        let healthStatus = 'Good';
        if (bufferHealth < CONFIG.lowBufferThreshold) healthStatus = 'Critical';
        else if (bufferHealth < CONFIG.fairBufferThreshold) healthStatus = 'Low';
        else if (bufferHealth < CONFIG.goodBufferThreshold) healthStatus = 'Fair';
        
        document.getElementById('buffer-health-indicator').textContent = `Health: ${healthStatus}`;
        document.getElementById('buffer-health-status').textContent = healthStatus;
    }
}

function updateBufferTimeline() {
    const timeline = document.getElementById('buffer-timeline');
    const buffered = video.buffered;
    const currentTime = video.currentTime;
    const duration = video.duration || 100; // Fallback for live streams
    
    if (buffered.length > 0 && duration > 0) {
        const bufferStart = Math.max(0, currentTime - CONFIG.bufferStartOffset); 
        const bufferEnd = buffered.end(buffered.length - 1);
        const windowSize = CONFIG.bufferTimelineWindow; 
        
        const currentPos = ((currentTime - bufferStart) / windowSize) * 100;
        const bufferedPos = ((bufferEnd - bufferStart) / windowSize) * 100;
        
        timeline.style.background = `linear-gradient(to right, 
            #666 0%, 
            #666 ${Math.max(0, currentPos)}%, 
            #4CAF50 ${Math.max(0, currentPos)}%, 
            #4CAF50 ${Math.min(100, bufferedPos)}%, 
            #666 ${Math.min(100, bufferedPos)}%)`;
    }
}

function updateBandwidth() {
    if (hls && hls.bandwidthEstimate) {
        const bw = Math.round(hls.bandwidthEstimate/1000);
        document.getElementById('bandwidth').textContent = `${bw} kbps`;
        document.getElementById('bw-estimate').textContent = `${bw} kbps`;
    }
}

function updateDroppedFrames() {
    if (video.getVideoPlaybackQuality) {
        const playbackQuality = video.getVideoPlaybackQuality();
        document.getElementById('dropped-frames').textContent = 
            playbackQuality.droppedVideoFrames || 0;
    }
}

function updateLoadingState() {
    const states = ['loading', 'loaded', 'playing', 'paused', 'ended'];
    let currentState = 'unknown';
    
    if (video.ended) currentState = 'ended';
    else if (video.paused) currentState = 'paused';
    else if (video.readyState < 4) currentState = 'loading';
    else currentState = 'playing';
    
    document.getElementById('loading-state').textContent = currentState;
}

function updateQualitySwitchDisplay() {
    const historyDiv = document.getElementById('switch-history');
    const recent = abrState.qualitySwitchHistory.slice(-CONFIG.maxDisplaySwitches);
    
    if (recent.length === 0) {
        historyDiv.innerHTML = '<div class="switch-entry"><span class="timestamp">No switches yet</span></div>';
        return;
    }
    
    historyDiv.innerHTML = recent.map(switchInfo => `
        <div class="switch-entry">
            <span class="timestamp">${new Date(switchInfo.timestamp).toLocaleTimeString()}</span>
            <span class="quality">${switchInfo.resolution}</span>
            <span class="bitrate">${Math.round(switchInfo.bitrate/1000)}kbps</span>
        </div>
    `).join('');
}

function updateABRTransparency() {
    // Predict next decision
    const bufferHealth = video.buffered.length > 0 ? 
        video.buffered.end(video.buffered.length - 1) - video.currentTime : 0;
    const bandwidth = hls && hls.bandwidthEstimate ? hls.bandwidthEstimate / 1000 : 0;
    
    let nextDecision = 'Maintain quality';
    if (bufferHealth < 10 && hls && hls.currentLevel > 0) {
        nextDecision = 'Consider downgrade';
    } else if (bufferHealth > 25 && bandwidth > 3000 && hls && hls.currentLevel < hls.levels.length - 1) {
        nextDecision = 'Consider upgrade';
    }
    
    document.getElementById('next-decision').textContent = nextDecision;
}

function updateSwitchFrequency() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentSwitches = abrState.qualitySwitchHistory.filter(s => s.timestamp > oneMinuteAgo);
    document.getElementById('switch-frequency').textContent = `${recentSwitches.length}/min`;
}

function addToDecisionLog(entry) {
    abrState.decisionLog.push(entry);
    
    // Keep only last entries according to config
    if (abrState.decisionLog.length > CONFIG.maxLogEntries) {
        abrState.decisionLog.shift();
    }
    
    updateDecisionLogDisplay();
}

function updateDecisionLogDisplay() {
    const logDiv = document.getElementById('log-entries');
    
    if (abrState.decisionLog.length === 0) {
        logDiv.innerHTML = '<div class="log-entry">Waiting for ABR decisions...</div>';
        return;
    }
    
    logDiv.innerHTML = abrState.decisionLog.slice(-10).reverse().map(entry => `
        <div class="log-entry">
            <strong>${entry.timestamp.toLocaleTimeString()}</strong> - ${entry.action}<br>
            <span style="color: #aaa;">${entry.details || ''}</span>
        </div>
    `).join('');
    
    // Auto-scroll to top to show latest entry
    logDiv.scrollTop = 0;
}

// Stutter Detection Functions
function setupStutterDetection() {
    // Track when playback starts
    video.addEventListener('playing', () => {
        console.log("playing...")
        if (stutterState.playbackStartTime === 0) {
            stutterState.playbackStartTime = Date.now();
        }
        playerState.lastUpdateTime = Date.now();
        stutterState.lastPlayPosition = video.currentTime;
        
        if (stutterState.isStuttering) {
            // If we were stuttering, record the stutter end
            const stutterDuration = (Date.now() - stutterState.stutterStartTime) / 1000;
            stutterState.totalTime += stutterDuration;
            stutterState.isStuttering = false;
            
            // Add stutter to history
            stutterState.events.push({
                startTime: stutterState.stutterStartTime,
                duration: stutterDuration,
                position: video.currentTime
            });
            
            addToDecisionLog({
                timestamp: new Date(),
                action: 'Playback Resumed',
                details: `After ${stutterDuration.toFixed(2)}s stutter at position ${video.currentTime.toFixed(1)}s`
            });
            
            updateStutterMetrics();
        }
    });
    
    // Detect when video is waiting/buffering
    video.addEventListener('waiting', () => {
        console.log("buffering...")
        if (!stutterState.isStuttering) {
            stutterState.count++;
            stutterState.isStuttering = true;
            stutterState.stutterStartTime = Date.now();
            
            addToDecisionLog({
                timestamp: new Date(),
                action: 'Playback Stutter',
                details: `Stutter detected at position ${video.currentTime.toFixed(1)}s`
            });
        }
    });
    
    // Regular time update - detect if playback is not advancing
    video.addEventListener('timeupdate', () => {
        const now = Date.now();
        
        // Only check every defined interval
        if (now - playerState.lastUpdateTime < 250) return;
        
        // Update total playback time
        if (!video.paused && !video.ended) {
            stutterState.playbackTotalTime += (now - playerState.lastUpdateTime) / 1000;
        }
        
        // Check if video position hasn't advanced but we're not in a detected waiting state
        if (!video.paused && !video.seeking && !stutterState.isStuttering) {
            const expectedAdvance = (now - playerState.lastUpdateTime) / 1000 * CONFIG.expectedPlaybackRate;
            const actualAdvance = video.currentTime - stutterState.lastPlayPosition;
            
            if (actualAdvance < expectedAdvance && actualAdvance < CONFIG.minStutterAdvance && now - playerState.lastUpdateTime > 500) {
                // We detected a stutter that didn't trigger waiting event
                stutterState.count++;
                stutterState.isStuttering = true;
                stutterState.stutterStartTime = now;
                
                addToDecisionLog({
                    timestamp: new Date(),
                    action: 'Playback Stutter',
                    details: `Silent stutter detected at position ${video.currentTime.toFixed(1)}s`
                });
            }
        } else if (stutterState.isStuttering && video.currentTime > stutterState.lastPlayPosition + 0.5) {
            // Video has advanced significantly while in stutter state - must have resumed
            const stutterDuration = (now - stutterState.stutterStartTime) / 1000;
            stutterState.totalTime += stutterDuration;
            stutterState.isStuttering = false;
            
            // Add stutter to history
            stutterState.events.push({
                startTime: stutterState.stutterStartTime,
                duration: stutterDuration,
                position: video.currentTime
            });
            
            addToDecisionLog({
                timestamp: new Date(),
                action: 'Playback Resumed',
                details: `After ${stutterDuration.toFixed(2)}s silent stutter`
            });
            
            updateStutterMetrics();
        }
        
        playerState.lastUpdateTime = now;
        stutterState.lastPlayPosition = video.currentTime;
    });
}

function updateStutterMetrics() {
    // Update basic count and total time
    document.getElementById('stutter-count').textContent = stutterState.count;
    document.getElementById('stutter-total-time').textContent = `${stutterState.totalTime.toFixed(1)}s`;
        
    // Update stutter history visualization
    updateStutterVisualization();
}

function updateStutterVisualization() {
    const historyEl = document.getElementById('stutter-history');
    const now = Date.now();
    const windowSize = 60 * 1000;
    const startTime = now - windowSize;
    
    // Filter to recent stutters only
    const recentStutters = stutterState.events.filter(s => s.startTime >= startTime);
    
    if (recentStutters.length === 0) {
        historyEl.style.background = '#555';
        return;
    }
    
    // Create visualization of stutters
    let background = 'linear-gradient(to right, ';
    let lastPos = 0;
    
    recentStutters.forEach((stutter, index) => {
        const startPos = ((stutter.startTime - startTime) / windowSize) * 100;
        const endPos = Math.min(100, startPos + ((stutter.duration * 1000) / windowSize) * 100);
        
        // Add green section before stutter
        if (startPos > lastPos) {
            background += `#555 ${lastPos}%, #555 ${startPos}%, `;
        }
        
        // Add red section for stutter
        background += `#F44336 ${startPos}%, #F44336 ${endPos}%, `;
        
        lastPos = endPos;
    });
    
    // Add final section
    if (lastPos < 100) {
        background += `#555 ${lastPos}%, #555 100%`;
    } else {
        // Remove trailing comma and space
        background = background.slice(0, -2);
    }
    
    background += ')';
    historyEl.style.background = background;
}