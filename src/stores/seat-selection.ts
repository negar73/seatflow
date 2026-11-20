"use client";

/**
 * Zustand store for the seat-selection state on the event page.
 *
 * The store holds full seat snapshots (not just ids) so the summary sidebar
 * can render section/row/seat labels and prices without re-joining data.
 */

import { create } from "zustand";

import { MAX_SEATS_PER_HOLD } from "@/lib/constants";

export interface SelectedSeat {
  id: string;
  section: string;
  row: number;
  seatNumber: number;
  priceCents: number;
}

interface SeatSelectionState {
  selectedSeats: SelectedSeat[];
  /**
   * Toggle a seat in/out of the selection.
   * Returns `atLimit: true` when the attempt was rejected because the hold
   * ceiling was reached — the UI surfaces a hint instead of failing later.
   */
  toggleSeat: (seat: SelectedSeat) => { added: boolean; atLimit: boolean };
  isSelected: (seatId: string) => boolean;
  totalCents: () => number;
  clear: () => void;
}

export const useSeatSelection = create<SeatSelectionState>()((set, get) => ({
  selectedSeats: [],

  toggleSeat: (seat) => {
    const { selectedSeats } = get();
    const alreadySelected = selectedSeats.some((s) => s.id === seat.id);

    if (alreadySelected) {
      set({ selectedSeats: selectedSeats.filter((s) => s.id !== seat.id) });
      return { added: false, atLimit: false };
    }

    if (selectedSeats.length >= MAX_SEATS_PER_HOLD) {
      return { added: false, atLimit: true };
    }

    set({ selectedSeats: [...selectedSeats, seat] });
    return { added: true, atLimit: false };
  },

  isSelected: (seatId) => get().selectedSeats.some((s) => s.id === seatId),

  totalCents: () =>
    get().selectedSeats.reduce((sum, seat) => sum + seat.priceCents, 0),

  clear: () => set({ selectedSeats: [] }),
}));
