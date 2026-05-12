import { jsPDF } from 'jspdf'
import type { ExportProject } from './generateDocx'

export function generatePdf(project: ExportProject): Buffer {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 20
  const contentWidth = pageWidth - margin * 2
  let y = margin

  const addPage = () => {
    doc.addPage()
    y = margin
  }

  const checkPageBreak = (needed: number) => {
    const pageHeight = doc.internal.pageSize.getHeight()
    if (y + needed > pageHeight - margin) {
      addPage()
    }
  }

  // 제목
  doc.setFontSize(20)
  doc.setFont('helvetica', 'bold')
  doc.text(project.name, margin, y)
  y += 8

  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 100, 100)
  doc.text(project.institutionName, margin, y)
  doc.setTextColor(0, 0, 0)
  y += 12

  // 각 모듈
  const sorted = [...project.modules].sort((a, b) => a.order - b.order)
  for (const mod of sorted) {
    checkPageBreak(20)

    // 모듈 제목
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text(mod.name, margin, y)
    y += 5

    // 카테고리
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120, 120, 120)
    doc.text(`[${mod.category}]`, margin, y)
    doc.setTextColor(0, 0, 0)
    y += 6

    // 내용
    doc.setFontSize(10)
    const contentText = mod.content || '(미작성)'
    const lines = doc.splitTextToSize(contentText, contentWidth) as string[]
    for (const line of lines) {
      checkPageBreak(6)
      doc.text(line, margin, y)
      y += 5
    }
    y += 6
  }

  const arrayBuffer = doc.output('arraybuffer')
  return Buffer.from(arrayBuffer)
}
