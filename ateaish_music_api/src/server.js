import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { createDatabaseClient } from './db/client.js';
import { SpotifyProvider } from './providers/spotify.js';
import { YouTubeProvider } from './providers/youtube.js';
import { YtDlpProvider } from './providers/ytdlp.js';
import { createSearchRouter } from './routes/search.js';
import { createResolveRouter } from './routes/resolve.js';
import { createPlaylistsRouter } from './routes/playlists.js';
import { MemoryCache } from './services/cache.js';
import { MusicService } from './services/music-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });

const app = express();
const port = Number(process.env.PORT || 8787);
const frontendOrigin = process.env.FRONTEND_ORIGIN || true;

const db = createDatabaseClient({ rootDir });
db.purgeExpired();

const spotifyProvider = new SpotifyProvider({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  db,
  memoryCache: new MemoryCache(100)
});
const youtubeProvider = new YouTubeProvider({ apiKey: process.env.YOUTUBE_API_KEY });
const ytDlpProvider = new YtDlpProvider({
  enabled: process.env.YTDLP_ENABLED === '1',
  binaryPath: process.env.YTDLP_PATH || 'yt-dlp'
});
const musicService = new MusicService({
  db,
  spotifyProvider,
  youtubeProvider,
  ytDlpProvider
});

app.use(cors({ origin: frontendOrigin === 'true' ? true : frontendOrigin }));
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    providers: musicService.getStatus()
  });
});

app.use('/api/music', createSearchRouter(musicService));
app.use('/api/music', createResolveRouter(musicService));
app.use('/api/music', createPlaylistsRouter(musicService));

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({
    error: error.message || 'Unexpected server error.'
  });
});

app.listen(port, () => {
  console.log(`Ateaish Music API running on http://localhost:${port}`);
});