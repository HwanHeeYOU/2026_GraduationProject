import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'

export interface ExportProject {
  name: string
  institutionName: string
  modules: Array<{
    name: string
    category: string
    content: string
    order: number
  }>
}

export async function generateDocx(project: ExportProject): Promise<Buffer> {
  const children: Paragraph[] = []

  // 제목
  children.push(
    new Paragraph({
      text: project.name,
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({
      children: [new TextRun({ text: project.institutionName, color: '666666' })],
    }),
    new Paragraph({ text: '' })
  )

  // 각 모듈
  const sorted = [...project.modules].sort((a, b) => a.order - b.order)
  for (const mod of sorted) {
    children.push(
      new Paragraph({
        text: `${mod.name}`,
        heading: HeadingLevel.HEADING_2,
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `[${mod.category}]`,
            color: '888888',
            size: 18,
          }),
        ],
      }),
      new Paragraph({
        children: [new TextRun({ text: mod.content || '(미작성)' })],
      }),
      new Paragraph({ text: '' })
    )
  }

  const doc = new Document({ sections: [{ children }] })
  const buffer = await Packer.toBuffer(doc)
  return Buffer.from(buffer)
}
