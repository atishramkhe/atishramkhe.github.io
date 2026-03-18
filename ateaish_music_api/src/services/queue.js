export async function resolveQueueTracks(spotifyIds, resolveTrack) {
  const jobs = Array.isArray(spotifyIds) ? spotifyIds.map((spotifyId) => resolveTrack(spotifyId)) : [];
  return Promise.all(jobs);
}