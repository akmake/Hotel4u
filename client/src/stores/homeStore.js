// Home screen state shared by the menu, the header quick bar and the quick looks (gap-map item 8):
// the live counters, and which quick look is open.
import { create } from 'zustand';

export const useHomeStore = create((set) => ({
  counters: null,
  setCounters: (counters) => set({ counters }),
  look: null,
  open: (look) => set({ look }),
  close: () => set({ look: null }),
}));
