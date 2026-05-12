'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function useAutoSave(
  projectId: string,
  moduleId: string,
  initialContent: string
) {
  const [content, setContent] = useState(initialContent)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestContentRef = useRef(content)

  // content가 바뀔 때마다 ref 동기화
  useEffect(() => {
    latestContentRef.current = content
  }, [content])

  const save = useCallback(
    async (value: string) => {
      setSaveStatus('saving')
      try {
        const res = await fetch(`/api/projects/${projectId}/modules/${moduleId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: value }),
        })
        if (!res.ok) throw new Error('save failed')
        localStorage.removeItem(`draft_${projectId}_${moduleId}`)
        setSaveStatus('saved')
      } catch {
        localStorage.setItem(`draft_${projectId}_${moduleId}`, value)
        setSaveStatus('error')
      }
    },
    [projectId, moduleId]
  )

  // content 변경 시 debounce 3초 후 저장
  useEffect(() => {
    // 초기값과 동일하면 저장 트리거 안 함
    if (content === initialContent) return

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      save(latestContentRef.current)
    }, 3000)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  // 마운트 시 localStorage draft 복원
  useEffect(() => {
    const draft = localStorage.getItem(`draft_${projectId}_${moduleId}`)
    if (draft && draft !== initialContent) {
      setContent(draft)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { content, setContent, saveStatus }
}
