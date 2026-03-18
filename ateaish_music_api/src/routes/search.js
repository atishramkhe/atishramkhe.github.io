import express from 'express';

export function createSearchRouter(musicService) {
  const router = express.Router();

  router.get('/search', async (request, response, next) => {
    try {
      const query = String(request.query.q || '').trim();
      if (!query) {
        response.status(400).json({ error: 'Missing q query parameter.' });
        return;
      }
      const items = await musicService.search(query);
      response.json({
        items,
        providers: musicService.getStatus()
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}