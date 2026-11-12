// localStorage can throw (private windows, blocked storage); never let that break the game.
export const Settings = {
  get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
  // (false when it couldn't be saved: storage full or blocked)
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } },
};
