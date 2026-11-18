// Renders the single (invisible) <Audio> tag at the app root and forwards its
// events to PlayerService. key={sourceKey} remounts the tag per track, so each
// track gets a fresh native file source and PlayerService rebuilds the source node.
import { useEffect, useMemo } from 'react';
import { Audio } from 'react-native-audio-api';
import { useStore } from 'zustand';
import { PlayerService } from './PlayerService';

export function PlayerHost() {
  const ctx = useMemo(() => PlayerService.ensureContext(), []);
  const source = useStore(PlayerService.store, (s) => s.source);
  const sourceKey = useStore(PlayerService.store, (s) => s.sourceKey);

  useEffect(() => {
    PlayerService.init();
  }, []);

  if (!source) return null;
  return (
    <Audio
      key={sourceKey}
      ref={(h) => PlayerService.attachHandle(h)}
      context={ctx}
      source={source}
      preload="auto"
      onLoad={() => PlayerService.onLoad()}
      onPlaying={() => PlayerService.onPlaying()}
      onPlay={() => PlayerService.onPlaying()}
      onPause={() => PlayerService.onPause()}
      onWaiting={() => PlayerService.onWaiting()}
      onPositionChange={(t) => PlayerService.onPosition(t)}
      onEnded={() => PlayerService.onEnded()}
      onError={(e) => PlayerService.onError(e)}
    />
  );
}
