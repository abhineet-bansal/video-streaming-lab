const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Enable CORS for all routes
app.use(cors());

// Serve static files from content directory
app.use('/content', express.static(path.join(__dirname, '../../content')));

// Serve player files
app.use('/', express.static(path.join(__dirname, '../player')));

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`HLS stream available at: http://localhost:${PORT}/content/playlists/master_15s_segments.m3u8`);
});
