import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

// InstitutionModule 중복 확인
const dupes = await p.$queryRaw`
  SELECT institutionId, moduleId, COUNT(*) as cnt
  FROM InstitutionModule
  GROUP BY institutionId, moduleId
  HAVING cnt > 1
`
console.log('InstitutionModule duplicates:', dupes)

// ProjectModule 중복 확인 (모든 프로젝트)
const pmDupes = await p.$queryRaw`
  SELECT projectId, moduleId, COUNT(*) as cnt
  FROM ProjectModule
  GROUP BY projectId, moduleId
  HAVING cnt > 1
`
console.log('ProjectModule duplicates:', pmDupes)

// IRBModule 이름 중복 확인
const modDupes = await p.$queryRaw`
  SELECT name, COUNT(*) as cnt
  FROM IRBModule
  GROUP BY name
  HAVING cnt > 1
`
console.log('IRBModule name duplicates:', modDupes)

await p.$disconnect()
