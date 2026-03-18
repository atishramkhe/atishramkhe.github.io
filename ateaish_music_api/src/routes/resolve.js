import express from 'express';

export function createResolveRouter(musicService) {
  const router = express.Router();

  router.get('/resolve/:spotifyId', async (request, response, next) => {
    try {
      const resolved = await musicService.resolveTrack(String(request.params.spotifyId || '').trim());
      if (!resolved) {
        response.status(404).json({ error: 'Track not found.' });
        return;
      }
      response.json(resolved);
    } catch (error) {
      next(error);
    }
  });

  router.post('/queue/resolve', async (request, response, next) => {
    try {
      const spotifyIds = Array.isArray(request.body?.spotifyIds) ? request.body.spotifyIds : [];
      const items = await musicService.resolveQueue(spotifyIds);
      response.json({ items });
    } catch (error) {
      next(error);
    }
  });

  return router;
}