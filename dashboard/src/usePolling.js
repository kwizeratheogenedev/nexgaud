import { useEffect } from 'react';

/** Runs fn now and then every ms milliseconds, restarting when deps change. */
export function usePolling(fn, ms, deps) {
  useEffect(() => {
    let alive = true;
    const run = () => alive && fn();
    run();
    const id = setInterval(run, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
