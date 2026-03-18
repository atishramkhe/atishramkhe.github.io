import express from 'express';

export function createPlaylistsRouter(musicService) {
  const router = express.Router();

  router.get('/playlists', (_request, response) => {
    response.json({ items: musicService.listPlaylists() });
  });

  router.post('/playlists', (request, response) => {
    const playlist = musicService.createPlaylist({
      name: request.body?.name,
      tracks: request.body?.tracks
    });
    response.status(201).json(playlist);
  });

  router.patch('/playlists/:id', (request, response) => {
    const playlist = musicService.updatePlaylist(String(request.params.id || ''), {
      name: request.body?.name,
      tracks: request.body?.tracks
    });
    if (!playlist) {
      response.status(404).json({ error: 'Playlist not found.' });
      return;
    }
    response.json(playlist);
  });

  router.delete('/playlists/:id', (request, response) => {
    const result = musicService.deletePlaylist(String(request.params.id || ''));
    if (!result.changes) {
      response.status(404).json({ error: 'Playlist not found.' });
      return;
    }
    response.status(204).send();
  });

  return router;
}