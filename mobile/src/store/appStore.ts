import { create } from 'zustand'
import { Room } from '../api/client'

interface AppState {
  token: string | null
  selectedRoom: Room | null
  login: (token: string) => void
  selectRoom: (room: Room) => void
  backToRoomList: () => void
}

export const useAppStore = create<AppState>((set) => ({
  token: null,
  selectedRoom: null,
  login: (token) => set({ token }),
  selectRoom: (room) => set({ selectedRoom: room }),
  backToRoomList: () => set({ selectedRoom: null })
}))
