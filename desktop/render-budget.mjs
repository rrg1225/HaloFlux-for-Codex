const rates = [12, 16, 20];
const balancedMainCap = 30;

export function renderBudget() {
  let tier = 0;
  let stable = 0;
  let lastSample = -Infinity;
  return {
    reset() {
      tier = stable = 0;
      lastSample = -Infinity;
    },
    measure({ fps, p95 }, cap, now) {
      if (now - lastSample < 1750) return false;
      lastSample = now;
      const previous = tier;
      const target = Math.min(cap, balancedMainCap);
      if (fps < target * .91 || p95 > 1300 / target) {
        tier = Math.max(0, tier - 1);
        stable = 0;
      } else if (++stable >= 3) {
        tier = Math.min(rates.length - 1, tier + 1);
        stable = 0;
      }
      return previous !== tier;
    },
    limits(preferences, dual, mainFocused) {
      const { fps, overlayFps, budget } = preferences;
      if (budget === 'power') return { main: Math.min(fps, 20), overlay: Math.min(overlayFps, 20) };
      if (!dual) return { main: fps, overlay: overlayFps };
      if (budget === 'main') return { main: fps, overlay: Math.min(overlayFps, 8) };
      if (budget === 'overlay') return { main: mainFocused ? Math.min(fps, 12) : 0, overlay: overlayFps };
      return { main: Math.min(fps, balancedMainCap), overlay: Math.min(overlayFps, rates[tier]) };
    },
  };
}
