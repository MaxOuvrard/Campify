import { create } from 'zustand'
import { Room } from '../api/client'

interface AppState {
  token: string | null
  selectedRoom: Room | null
  isScanning: boolean
  login: (token: string) => void
  selectRoom: (room: Room) => void
  backToRoomList: () => void
  startScan: () => void
  stopScan: () => void
}

export const useAppStore = create<AppState>((set) => ({
  token: null,
  selectedRoom: null,
  isScanning: false,
  login: (token) => set({ token }),
  selectRoom: (room) => set({ selectedRoom: room }),
  backToRoomList: () => set({ selectedRoom: null }),
  startScan: () => set({ isScanning: true }),
  stopScan: () => set({ isScanning: false })
}))
