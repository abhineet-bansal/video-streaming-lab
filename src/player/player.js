const video = document.getElementById('video');
const streamUrl = 'http://localhost:3000/content/playlists/master_long.m3u8';

let hls;
const qualitySwitchHistory = [];
const decisionLog = [];

// Network Simulator Class
class NetworkSimulator {
    constructor() {
        this.bandwidthLimit = 5000; // kbps
        this.latency = 50; // ms
        this.packetLoss = 0; // percentage
        this.originalFetch = window.fetch;
        this.setupNetworkControls();
        this.injectFetchOverride();
    }
    
    setupNetworkControls() {
        // Bandwidth slider
        document.getElementById('bandwidth-slider').addEventListener('input', (e) => {
            this.setBandwidth(parseInt(e.target.value));
        });
        
        // Latency slider
        document.getElementById('latency-slider').addEventListener('input', (e) => {
            this.setLatency(parseInt(e.target.value));
        });
        
        // Loss slider
        document.getElementById('loss-slider').addEventListener('input', (e) => {
            this.setPacketLoss(parseFloat(e.target.value));
        });
    }
    
    setBandwidth(kbps) {
        this.bandwidthLimit = kbps;
        document.getElementById('bandwidth-value').textContent = `${kbps} kbps`;
        
        // Force hls.js to re-evaluate bandwidth
        if (window.hls && window.hls.bandwidthEstimate) {
            // Gradually adjust the estimate rather than sudden change
            window.hls.bandwidthEstimate = Math.min(window.hls.bandwidthEstimate, kbps * 1000);
        }
    }
    
    setLatency(ms) {
        this.latency = ms;
        document.getElementById('latency-value').textContent = `${ms}ms`;
    }
    
    setPacketLoss(percentage) {
        this.packetLoss = percentage;
        document.getElementById('loss-value').textContent = `${percentage}%`;
    }
    
    injectFetchOverride() {
        const simulator = this;
        window.fetch = function(url, options) {
            return simulator.simulateRequest(url, options);
        };
    }
    
    async simulateRequest(url, options) {
        // Add artificial latency
        if (this.latency > 0) {
            await new Promise(resolve => setTimeout(resolve, this.latency));
        }
        
        // Simulate packet loss
        if (Math.random() < this.packetLoss / 100) {
            throw new Error('Simulated network failure');
        }
        
        try {
            const response = await this.originalFetch(url, options);
            
            // Only throttle video segment requests, not playlist requests
            if (url.includes('.ts') || url.includes('.m4s')) {
                return this.throttleResponse(response);
            }
            
            return response;
        } catch (error) {
            console.log('Network request failed:', error.message);
            throw error;
        }
    }
    
    throttleResponse(response) {
        if (!response.body || this.bandwidthLimit >= 10000) {
            return response; // No throttling needed for very high bandwidth
        }
        
        const reader = response.body.getReader();
        const bytesPerSecond = (this.bandwidthLimit * 1000) / 8; // Convert kbps to bytes/sec
        
        return new Response(
            new ReadableStream({
                start(controller) {
                    let startTime = Date.now();
                    let totalBytesRead = 0;
                    
                    function pump() {
                        return reader.read().then(({ done, value }) => {
                            if (done) {
                                controller.close();
                                return;
                            }
                            
                            totalBytesRead += value.length;
                            const elapsed = (Date.now() - startTime) / 1000;
                            const expectedBytes = bytesPerSecond * elapsed;
                            
                            if (totalBytesRead > expectedBytes && elapsed > 0) {
                                const delay = ((totalBytesRead - expectedBytes) / bytesPerSecond) * 1000;
                                setTimeout(() => {
                                    controller.enqueue(value);
                                    pump();
                                }, Math.max(0, delay));
                            } else {
                                controller.enqueue(value);
                                pump();
                            }
                        });
                    }
                    
                    pump();
                }
            }),
            {
                headers: response.headers,
                status: response.status,
                statusText: response.statusText
            }
        );
    }
}

// Network presets
const networkPresets = {
    '3g': { bandwidth: 1000, latency: 200, loss: 1 },
    '4g': { bandwidth: 5000, latency: 100, loss: 0.5 },
    'wifi': { bandwidth: 25000, latency: 20, loss: 0.1 },
    'throttled': { bandwidth: 500, latency: 150, loss: 2 },
    'perfect': { bandwidth: 50000, latency: 5, loss: 0 }
};

function applyNetworkPreset(preset) {
    const config = networkPresets[preset];
    
    // Update the simulator
    networkSim.setBandwidth(config.bandwidth);
    networkSim.setLatency(config.latency);
    networkSim.setPacketLoss(config.loss);
    
    // Update UI sliders
    document.getElementById('bandwidth-slider').value = config.bandwidth;
    document.getElementById('latency-slider').value = config.latency;
    document.getElementById('loss-slider').value = config.loss;
    
    // Update active button
    document.querySelectorAll('.preset-buttons button').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    addToDecisionLog({
        timestamp: new Date(),
        action: 'Network Preset Applied',
        details: `${preset.toUpperCase()}: ${config.bandwidth}kbps, ${config.latency}ms, ${config.loss}% loss`
    });
}

// Initialize network simulator
const networkSim = new NetworkSimulator();

// HLS Player Setup
if (Hls.isSupported()) {
    hls = new Hls({
        debug: false, // Set to false to reduce console noise
        enableWorker: true,
        lowLatencyMode: false,
    });

    window.hls = hls; // Make globally accessible

    hls.loadSource(streamUrl);
    hls.attachMedia(video);

    // Event listeners for learning ABR behavior
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
        
        qualitySwitchHistory.push(switchInfo);
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

} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Fallback for Safari
    video.src = streamUrl;
}

function determineSwitchReason(data, bufferHealth, bandwidth) {
    if (!hls.levels[data.level]) return 'Unknown';
    
    const targetBitrate = hls.levels[data.level].bitrate / 1000;
    const currentBitrate = hls.currentLevel >= 0 && hls.levels[hls.currentLevel] ? 
        hls.levels[hls.currentLevel].bitrate / 1000 : 0;
    
    if (bufferHealth < 5) return 'Low buffer - emergency downgrade';
    if (bufferHealth > 20 && bandwidth > targetBitrate * 1.5 && data.level > hls.currentLevel) 
        return 'Sufficient buffer + bandwidth - upgrade';
    if (bandwidth < currentBitrate * 0.8 && data.level < hls.currentLevel) 
        return 'Insufficient bandwidth - downgrade';
    return 'Routine optimization';
}

function updateStats() {
    if (!hls) return;
    
    // Update stats every second
    setInterval(() => {
        updateCurrentQuality();
        updateBufferHealth();
        updateBandwidth();
        updateDroppedFrames();
        updateLoadingState();
        updateBufferTimeline();
        updateABRTransparency();
        updateSwitchFrequency();
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
        
        // Update buffer health indicator
        let healthStatus = 'Good';
        if (bufferHealth < 5) healthStatus = 'Critical';
        else if (bufferHealth < 10) healthStatus = 'Low';
        else if (bufferHealth < 20) healthStatus = 'Fair';
        
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
        const bufferStart = Math.max(0, currentTime - 5); // Show 5 seconds behind
        const bufferEnd = buffered.end(buffered.length - 1);
        const windowSize = 60; // Show 60 second window
        
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
    const recent = qualitySwitchHistory.slice(-5); // Show last 5 switches
    
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
    const recentSwitches = qualitySwitchHistory.filter(s => s.timestamp > oneMinuteAgo);
    document.getElementById('switch-frequency').textContent = `${recentSwitches.length}/min`;
}

function addToDecisionLog(entry) {
    decisionLog.push(entry);
    
    // Keep only last 20 entries
    if (decisionLog.length > 20) {
        decisionLog.shift();
    }
    
    updateDecisionLogDisplay();
}

function updateDecisionLogDisplay() {
    const logDiv = document.getElementById('log-entries');
    
    if (decisionLog.length === 0) {
        logDiv.innerHTML = '<div class="log-entry">Waiting for ABR decisions...</div>';
        return;
    }
    
    logDiv.innerHTML = decisionLog.slice(-10).reverse().map(entry => `
        <div class="log-entry">
            <strong>${entry.timestamp.toLocaleTimeString()}</strong> - ${entry.action}<br>
            <span style="color: #aaa;">${entry.details || ''}</span>
        </div>
    `).join('');
    
    // Auto-scroll to top to show latest entry
    logDiv.scrollTop = 0;
}