knowledge-doc.md

# ABR Video Playback Prototype

## Project Goals

**Learning Objectives:**
- Understand techniques for preventing stuttering in video playback
- Understand the concepts of fMP4, ABR, HLS + DASH, CMAF, bitrate etc.
- See buffer management and other techniques in action
- Extend the basic prototype to more advanced techniques for smooth playback

**Deliverable:**
- Demo of how ABR works, visually showing decisions in realtime that ensure smooth playback

## Architecture Overview

**Development Environment:** macOS

**Pipeline:**
```
Raw video files → Convert to fMP4 with multiple bitrate ladders → Create HLS playlist files → Host on local web server → Browser-based video player with real-time visualization
```

## Detailed Architecture

### 1. Content Preparation
- **Input:** Raw video files
- **Output:** Multiple bitrate/resolution ladders
  - Example ladder: 240p/500kbps, 480p/1.5Mbps, 720p/3Mbps, 1080p/6Mbps
- **Format:** fMP4 segments for HLS
- **Future consideration:** CMAF segments for both HLS and DASH support

### 2. Manifest Generation
- **Protocol:** HLS (with potential DASH extension later)
- **Format:** m3u8 playlist files
- **Structure:** Master playlist + media playlists for each bitrate

### 3. Local Web Server
- Host manifest files and media segments
- Serve content to browser-based player

### 4. Browser-Based Video Player

**Core Player:** hls.js (chosen for learning-friendly codebase and HLS focus)

**UI Components:**

#### A. Playback Stats Panel (Top Right)
- Buffer health visualization (numerical + timeline view)
- Current download speed
- Active resolution/bitrate
- Frame rate
- Network bandwidth estimation
- Recent quality switches with timestamps

#### B. Network Simulation Controls (Bottom Right)
- Bandwidth throttling slider
- Latency simulation
- Packet loss simulation
- Preset network condition profiles (3G, 4G, WiFi, etc.)

#### C. ABR Algorithm Transparency Panel
- Current ABR decision factors display
- Buffer health thresholds
- Bandwidth estimation methodology
- Quality switch reasoning log

### 5. ABR Implementation Strategy

**Step 1:** Study existing hls.js ABR algorithm
- Understand default implementation
- Expose internal state for visualization
- Build comprehensive dashboard

**Step 2:** Custom ABR development
- Implement custom algorithm as hls.js plugin/override
- Side-by-side comparison: "Default ABR vs Custom ABR"
- A/B testing framework for different approaches

**Step 3:** Advanced techniques
- Sophisticated buffer management
- Predictive quality switching
- User context awareness (device capabilities, viewing patterns)

## Technical Decisions & Rationale

### Why HLS over DASH for Prototype?
- Simpler manifest format (m3u8 vs MPD)
- Less configuration complexity
- Focus on core ABR concepts rather than protocol specifics
- hls.js provides excellent learning visibility into ABR internals
- Can extend to DASH later using Shaka Player if needed

### Why hls.js over other players?
- Clean, readable codebase ideal for learning
- Well-exposed ABR internals
- Active community and documentation
- Easy to extend and customize

## Implementation Phases

**Phase 1: Basic Pipeline**
1. Set up content encoding with multiple bitrates
2. Generate HLS manifests
3. Set up local web server
4. Implement basic hls.js player with stats visualization

**Phase 2: Enhanced Visualization**
1. Real-time buffer health display
2. Network condition simulation controls
3. ABR decision transparency panel

**Phase 3: Custom ABR Algorithm**
1. Study hls.js default ABR implementation
2. Implement custom ABR logic
3. Comparative analysis tools

**Phase 4: Advanced Features**
1. Sophisticated buffer management techniques
2. Predictive algorithms
3. Performance optimization and edge case handling

## Success Metrics

- Visual, real-time demonstration of ABR decision-making
- Ability to simulate various network conditions and observe player adaptation
- Working custom ABR algorithm with measurable improvements over baseline
- Deep understanding of video streaming concepts through hands-on implementation

## Future Extensions

- DASH protocol support using CMAF
- Multiple ABR algorithm comparison framework
- Advanced metrics and analytics
- Integration with CDN concepts
- Mobile optimization techniques


# Appendix

## AI Prompts

Starting prompt, to make the prototype plan:
```
I want to build a prototype for ABR in video playback.

Goals:
* Understand techniques for preventing stuttering in video playback
* Understand the concepts of fMP4, ABR, HLS + DASH, CMAF, bitrate etc.
* See buffer management and other techniques in action
* Then extend the basic prototype to more advanced techniques for smooth playback.

Output:
* Demo of how ABR works, visually showing decisions in realtime that ensure smooth playback.

Proposed Architecture (I will be working on a Mac):
Raw video files -> convert to fMP4 -> create HLS/DASH playlist/manifest files -> host the manifest file and chunked media on a local web server -> browser/web based video player which has: (a) an element on the top right to show the playback stats (such as buffer health, download speed, resolution, bitrate, fps etc.), and (b) a section on the bottom right to allow the user to turn the knobs of changing bandwidth, and other practical factors in realtime.

Critique this plan and make improvements. Ask questions one at a time if you want clarity.
```
