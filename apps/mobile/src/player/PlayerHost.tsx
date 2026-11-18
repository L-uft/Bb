// Renders the single (invisible) <Audio> tag at the app root and forwards its
// events to PlayerService. key={sourceKey} remounts the tag per track, so each
// track gets a fresh native file source and the old one is released.
// The AudioContext is created lazily by PlayerService (after the audio session is
// active), so the tag only renders once both a source and a context exist.
import { useEffect } from 'react';
import { Audio } from 'react-native-audio-api';
import { useStore } from 'zustand';
import { PlayerService } from './PlayerService';

export function PlayerHost() {
  const source = useStore(PlayerService.store, (s) => s.source);
  const sourceKey = useStore(PlayerService.store, (s) => s.sourceKey);

  useEffect(() => {
    PlayerService.init();
  }, []);

  const ctx = PlayerService.context;
  if (!source || !ctx) return null;
  return (
    <Audio
      key={sourceKey}
      ref={(h) => PlayerService.attachHandle(h)}
      context={ctx}
      source={source}
      preload="auto"
      onLoad={() => PlayerService.onLoad()}
      onPlay={() => PlayerService.onPlayCalled()}
      onPlaying={() => PlayerService.onBufferReady()}
      onPause={() => PlayerService.onPause()}
      onWaiting={() => PlayerService.onWaiting()}
      onPositionChange={(t) => PlayerService.onPosition(t)}
      onEnded={() => PlayerService.onEnded()}
      onError={(e) => PlayerService.onError(e)}
    />
  );
}
