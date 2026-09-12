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
  const savedContentRef = useRef(initialContent) // 마지막으로 DB에 저장된 값

  useEffect(() => {
    latestContentRef.current = content
  }, [content])

  const save = useCallback(
    async (value: string) => {
      if (value === savedContentRef.current) return // 변경 없으면 스킵
      setSaveStatus('saving')
      try {
        const res = await fetch(`/api/projects/${projectId}/modules/${moduleId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: value }),
        })
        if (!res.ok) throw new Error('save failed')
        savedContentRef.current = value
        localStorage.removeItem(`draft_${projectId}_${moduleId}`)
        setSaveStatus('saved')
      } catch {
        localStorage.setItem(`draft_${projectId}_${moduleId}`, value)
        setSaveStatus('error')
      }
    },
    [projectId, moduleId]
  )

  // content 변경 시 debounce 2초 후 저장
  useEffect(() => {
    if (content === savedContentRef.current) return

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      save(latestContentRef.current)
    }, 2000)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [content, save])

  // 언마운트 시 미저장 내용 즉시 저장 (페이지 이동 대응)
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      const current = latestContentRef.current
      if (current !== savedContentRef.current) {
        // fetch를 keepalive로 보내서 페이지 이동 후에도 완료되도록
        fetch(`/api/projects/${projectId}/modules/${moduleId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: current }),
          keepalive: true,
        }).then(() => {
          localStorage.removeItem(`draft_${projectId}_${moduleId}`)
        }).catch(() => {
          localStorage.setItem(`draft_${projectId}_${moduleId}`, current)
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 마운트 시 localStorage draft 복원
  useEffect(() => {
    const draft = localStorage.getItem(`draft_${projectId}_${moduleId}`)
    if (draft && draft !== initialContent) {
      setContent(draft)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { content, setContent, saveStatus, flushSave: () => save(latestContentRef.current) }
}
