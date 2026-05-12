'use client'

import { useNetworkSync } from '@/hooks/useNetworkSync'

interface NetworkSyncProviderProps {
  children: React.ReactNode
}

export default function NetworkSyncProvider({ children }: NetworkSyncProviderProps) {
  useNetworkSync()
  return <>{children}</>
}
