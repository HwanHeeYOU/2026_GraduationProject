'use client'

import { useEffect } from 'react'

export function useNetworkSync() {
  useEffect(() => {
    const syncDrafts = async () => {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith('draft_')) {
          keys.push(key)
        }
      }

      for (const key of keys) {
        const content = localStorage.getItem(key)
        if (!content) continue

        // key 형식: draft_{projectId}_{moduleId}
        const withoutPrefix = key.slice('draft_'.length)
        // projectId는 cuid (24자), moduleId도 cuid
        // 마지막 _ 기준으로 분리
        const lastUnderscore = withoutPrefix.lastIndexOf('_')
        if (lastUnderscore === -1) continue

        const projectId = withoutPrefix.slice(0, lastUnderscore)
        const moduleId = withoutPrefix.slice(lastUnderscore + 1)

        try {
          const res = await fetch(`/api/projects/${projectId}/modules/${moduleId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
          })
          if (res.ok) {
            localStorage.removeItem(key)
          }
        } catch {
          // 동기화 실패 시 다음 기회에 재시도
        }
      }
    }

    window.addEventListener('online', syncDrafts)
    return () => window.removeEventListener('online', syncDrafts)
  }, [])
}
