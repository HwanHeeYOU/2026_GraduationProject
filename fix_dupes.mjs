/**
 * 중복 IRBModule 정리 스크립트
 * - 동일한 name을 가진 IRBModule 중 cuid 기반 ID (시드 외) 중복을 제거
 * - 먼저 해당 중복 모듈을 참조하는 InstitutionModule / ProjectModule을 원본으로 교체한 뒤 삭제
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const modules = await prisma.iRBModule.findMany({ orderBy: { createdAt: 'asc' } }).catch(() =>
  prisma.iRBModule.findMany({ orderBy: { order: 'asc' } })
)

// 이름 기준으로 그룹핑
const nameMap = new Map()
for (const m of modules) {
  if (!nameMap.has(m.name)) nameMap.set(m.name, [])
  nameMap.get(m.name).push(m)
}

const dupGroups = [...nameMap.entries()].filter(([, arr]) => arr.length > 1)

if (dupGroups.length === 0) {
  console.log('✅ 중복 없음 — 정리 불필요')
  await prisma.$disconnect()
  process.exit(0)
}

console.log(`\n중복 그룹 ${dupGroups.length}개 발견\n`)

for (const [name, arr] of dupGroups) {
  // 시드 ID (module-XX 형식)를 우선 보존 대상으로, 없으면 첫 번째
  const keeper = arr.find(m => /^module-\d+$/.test(m.id)) ?? arr[0]
  const dupes = arr.filter(m => m.id !== keeper.id)

  console.log(`"${name}": 보존=${keeper.id}, 삭제 대상=${dupes.map(m => m.id).join(', ')}`)

  for (const dupe of dupes) {
    // InstitutionModule: 중복 모듈을 참조하는 링크 중 keeper와 같은 기관이면 그냥 삭제, 아니면 moduleId 교체
    const imLinks = await prisma.institutionModule.findMany({ where: { moduleId: dupe.id } })
    for (const link of imLinks) {
      const alreadyExists = await prisma.institutionModule.findUnique({
        where: { institutionId_moduleId: { institutionId: link.institutionId, moduleId: keeper.id } },
      })
      if (alreadyExists) {
        // keeper가 이미 이 기관에 연결되어 있으므로 중복 링크만 제거
        await prisma.institutionModule.delete({ where: { id: link.id } })
        console.log(`  InstitutionModule ${link.id} 삭제 (keeper 이미 존재)`)
      } else {
        // keeper로 moduleId 교체
        await prisma.institutionModule.update({ where: { id: link.id }, data: { moduleId: keeper.id } })
        console.log(`  InstitutionModule ${link.id} → keeper ${keeper.id}로 교체`)
      }
    }

    // ProjectModule: 중복 모듈을 참조하는 레코드 교체
    const pmLinks = await prisma.projectModule.findMany({ where: { moduleId: dupe.id } })
    for (const link of pmLinks) {
      const alreadyExists = await prisma.projectModule.findUnique({
        where: { projectId_moduleId: { projectId: link.projectId, moduleId: keeper.id } },
      })
      if (alreadyExists) {
        await prisma.projectModule.delete({ where: { id: link.id } })
        console.log(`  ProjectModule ${link.id} 삭제 (keeper 이미 존재)`)
      } else {
        await prisma.projectModule.update({ where: { id: link.id }, data: { moduleId: keeper.id } })
        console.log(`  ProjectModule ${link.id} → keeper ${keeper.id}로 교체`)
      }
    }

    // 이제 중복 모듈 삭제
    await prisma.iRBModule.delete({ where: { id: dupe.id } })
    console.log(`  IRBModule "${dupe.id}" 삭제 완료`)
  }
}

// 결과 확인
const remaining = await prisma.iRBModule.findMany({ orderBy: { order: 'asc' } })
console.log(`\n✅ 정리 완료. 남은 모듈 수: ${remaining.length}`)
for (const m of remaining) console.log(`  [${m.id}] ${m.name}`)

await prisma.$disconnect()
