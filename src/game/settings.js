// localStorage can throw (private windows, blocked storage); never let that break the game.
export const Settings = {
  get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch (e) {} },
};
