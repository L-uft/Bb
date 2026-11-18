// Synthetic InnerTube player response: the shape matters, the values are made up.
export const GV = (itag: number, client = 'IOS', expireSec = 2_000_000_000) =>
  `https://rr1---sn-test.googlevideo.com/videoplayback?expire=${expireSec}&itag=${itag}&c=${client}&mime=audio%2Fmp4`;

export function playerResponse(client = 'IOS', expireSec?: number) {
  return {
    playabilityStatus: { status: 'OK' },
    videoDetails: { videoId: 'dQw4w9WgXcQ', title: 'Test title', author: 'Test author', lengthSeconds: '213' },
    streamingData: {
      formats: [{ itag: 18, url: GV(18, client, expireSec), mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', bitrate: 500000 }],
      adaptiveFormats: [
        { itag: 399, url: GV(399, client, expireSec), mimeType: 'video/mp4; codecs="av01.0.08M.08"', bitrate: 1500000 },
        { itag: 251, url: GV(251, client, expireSec), mimeType: 'audio/webm; codecs="opus"', bitrate: 140000 },
        { itag: 140, url: GV(140, client, expireSec), mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, contentLength: '3449000', approxDurationMs: '213000' },
        { itag: 139, url: GV(139, client, expireSec), mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 49000 },
        { itag: 141, signatureCipher: 's=abc&url=https%3A%2F%2Fexample', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 260000 },
      ],
    },
  };
}
