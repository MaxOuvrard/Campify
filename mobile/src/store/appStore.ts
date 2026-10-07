import { create } from 'zustand'
import { Room } from '../api/client'

export interface HistoryTarget {
  deviceId: string
  deviceName: string
  type: string
}

interface AppState {
  token: string | null
  selectedRoom: Room | null
  isScanning: boolean
  historyTarget: HistoryTarget | null
  login: (token: string) => void
  selectRoom: (room: Room) => void
  backToRoomList: () => void
  startScan: () => void
  stopScan: () => void
  openHistory: (target: HistoryTarget) => void
  closeHistory: () => void
}

export const useAppStore = create<AppState>((set) => ({
  token: null,
  selectedRoom: null,
  isScanning: false,
  historyTarget: null,
  login: (token) => set({ token }),
  selectRoom: (room) => set({ selectedRoom: room }),
  backToRoomList: () => set({ selectedRoom: null }),
  startScan: () => set({ isScanning: true }),
  stopScan: () => set({ isScanning: false }),
  openHistory: (target) => set({ historyTarget: target }),
  closeHistory: () => set({ historyTarget: null })
}))
