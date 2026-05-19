import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // 로컬 개발용 계정
  const hashedPassword = await bcrypt.hash('password123', 10)
  await prisma.user.upsert({
    where: { email: 'dev@test.com' },
    update: {},
    create: {
      email: 'dev@test.com',
      password: hashedPassword,
      name: '개발용 연구자',
    },
  })
  console.log('✅ Created dev user (dev@test.com / password123)')

  // IRB 모듈 10개 생성
  const irbModules = await Promise.all([
    prisma.iRBModule.upsert({
      where: { id: 'module-01' },
      update: {},
      create: {
        id: 'module-01',
        name: '연구 목적 및 필요성',
        description: '연구의 목적, 배경, 필요성을 기술합니다.',
        category: '기본정보',
        isRequired: true,
        order: 1,
        hasFormula: false,
        promptHint: '연구 목적, 사회적 필요성, 기대 효과를 포함하여 작성하세요.',
      },
    }),
    prisma.iRBModule.upsert({
      where: { id: 'module-02' },
      update: {},
      create: {
        id: 'module-02',
        name: '연구 방법 및 절차',
        description: '연구 설계, 방법론, 진행 절차를 상세히 기술합니다.',
        category: '연구방법',
        isRequired: true,
        order: 2,
        hasFormula: false,
        promptHint: '연구 설계 유형, 데이터 수집 방법, 분석 방법을 포함하여 작성하세요.',
      },
    }),
    prisma.iRBModule.upsert({
      where: { id: 'module-03' },
      update: {},
      create: {
        id: 'module-03',
        name: '연구 대상자 선정 기준',
        description: '연구에 참여할 대상자의 포함 기준을 기술합니다.',
        category: '연구대상',
        isRequired: true,
        order: 3,
        hasFormula: false,
        promptHint: '연령, 성별, 진단명, 기타 포함 조건을 명확히 기술하세요.',
      },
    }),
    prisma.iRBModule.upsert({
      where: { id: 'module-04' },
      update: {},
      create: {
        id: 'module-04',
        name: '연구 대상자 제외 기준',
        description: '연구 참여에서 제외되어야 할 대상자의 기준을 기술합니다.',
        category: '연구대상',
        isRequired: false,
        order: 4,
        hasFormula: false,
        promptHint: '안전상의 이유, 연구 결과에 영향을 미칠 수 있는 조건 등을 포함하세요.',
      },
    }),
    prisma.iRBModule.upsert({
      where: { id: 'module-05' },
      update: {},
      create: {
        id: 'module-05',
        name: '표본 크기 계산',
        description: '통계적 근거에 기반한 연구 대상자 수 산출 방법을 기술합니다.',
        category: '연구방법',
        isRequired: true,
        order: 5,
        hasFormula: true,
        promptHint: '검정력(power), 유의수준(α), 효과크기(effect size)를 포함한 표본 크기 계산식을 제시하세요.',
      },
    }),
    prisma.iRBModule.upsert({
      where: { id: 'module-06' },
      update: {},
      create: {
        id: 'module-06',
        name: '위험 및 이익 평가',
        description: '연구 참여로 인한 잠재적 위험과 기대되는 이익을 평가합니다.',
        category: '윤리',
        isRequired: true,
        order: 6,
        hasFormula: false,
        promptHint: '예상되는 위험의 종류와 정도, 위험 최소화 방안, 기대 이익을 균형 있게 기술하세요.',
      },
    }),
    prisma.iRBModule.upsert({
      where: { id: 'module-07' },
      update: {},
      create: {
        id: 'module-07',
        name: '개인정보 보호 방안',
        description: '연구 대상자의 개인정보 보호를 위한 구체적인 방안을 기술합니다.',
        category: '윤리',
        isRequired: true,
        order: 7,
        hasFormula: false,
        promptHint: '데이터 익명화/가명화 방법, 접근 권한 관리, 보관 기간 및 파기 방법을 포함하세요.',
      },
    }),
    prisma.iRBModule.upsert({
      where: { id: 'module-08' },
      update: {},
      create: {
        id: 'module-08',
        name: '동의서 작성 방법',
        description: '연구 대상자로부터 자발적 동의를 얻는 절차를 기술합니다.',
        category: '동의',
        isRequired: true,
        order: 8,
        hasFormula: false,
        promptHint: '동의 취득 방법, 동의 철회 절차, 취약한 대상자에 대한 특별 고려사항을 포함하세요.',
      },
    }),
    prisma.iRBModule.upsert({
      where: { id: 'module-09' },
      update: {},
      create: {
        id: 'module-09',
        name: '연구비 및 보상',
        description: '연구 재원 및 연구 참여에 대한 보상 내용을 기술합니다.',
        category: '기타',
        isRequired: false,
        order: 9,
        hasFormula: false,
        promptHint: '연구비 출처, 연구 참여 보상 금액 및 방법, 보상이 자발적 참여를 저해하지 않음을 명시하세요.',
      },
    }),
    prisma.iRBModule.upsert({
      where: { id: 'module-10' },
      update: {},
      create: {
        id: 'module-10',
        name: '이해충돌 선언',
        description: '연구자의 이해충돌 여부를 선언합니다.',
        category: '기타',
        isRequired: false,
        order: 10,
        hasFormula: false,
        promptHint: '연구자와 연구 결과 사이의 잠재적 이해충돌 여부를 명확히 기술하세요.',
      },
    }),
  ])

  console.log(`✅ Created ${irbModules.length} IRB modules`)

  // 학교 목록
  const institutionData = [
    { id: 'inst-snu',       name: '서울대학교',           shortName: 'Seoul National' },
    { id: 'inst-yonsei',    name: '연세대학교',           shortName: 'Yonsei' },
    { id: 'inst-korea',     name: '고려대학교',           shortName: 'Korea' },
    { id: 'inst-sogang',    name: '서강대학교',           shortName: 'Sogang' },
    { id: 'inst-skku',      name: '성균관대학교',         shortName: 'Sungkyunkwan' },
    { id: 'inst-hanyang',   name: '한양대학교',           shortName: 'Hanyang' },
    { id: 'inst-cau',       name: '중앙대학교',           shortName: 'Chung-Ang' },
    { id: 'inst-khu',       name: '경희대학교',           shortName: 'Kyung Hee' },
    { id: 'inst-hufs',      name: '한국외국어대학교',     shortName: 'HUFS' },
    { id: 'inst-uos',       name: '서울시립대학교',       shortName: 'UOS' },
    { id: 'inst-konkuk',    name: '건국대학교',           shortName: 'Konkuk' },
    { id: 'inst-dongguk',   name: '동국대학교',           shortName: 'Dongguk' },
    { id: 'inst-hongik',    name: '홍익대학교',           shortName: 'Hongik' },
    { id: 'inst-ajou',      name: '아주대학교',           shortName: 'Ajou' },
    { id: 'inst-inha',      name: '인하대학교',           shortName: 'Inha' },
    { id: 'inst-seoultech', name: '서울과학기술대학교',   shortName: 'Seoul TECH' },
    { id: 'inst-kookmin',   name: '국민대학교',           shortName: 'Kookmin' },
    { id: 'inst-soongsil',  name: '숭실대학교',           shortName: 'Soongsil' },
    { id: 'inst-sejong',    name: '세종대학교',           shortName: 'Sejong' },
    { id: 'inst-dankook',   name: '단국대학교',           shortName: 'Dankook' },
    { id: 'inst-kwangwoon', name: '광운대학교',           shortName: 'Kwangwoon' },
    { id: 'inst-myongji',   name: '명지대학교',           shortName: 'Myongji' },
    { id: 'inst-sangmyung', name: '상명대학교',           shortName: 'Sangmyung' },
    { id: 'inst-gachon',    name: '가천대학교',           shortName: 'Gachon' },
    { id: 'inst-kyonggi',   name: '경기대학교',           shortName: 'Kyonggi' },
    { id: 'inst-inu',       name: '인천대학교',           shortName: 'Incheon National' },
    { id: 'inst-pnu',       name: '부산대학교',           shortName: 'Pusan National' },
    { id: 'inst-knu',       name: '경북대학교',           shortName: 'Kyungpook National' },
    { id: 'inst-chonnam',   name: '전남대학교',           shortName: 'Chonnam National' },
    { id: 'inst-cnu',       name: '충남대학교',           shortName: 'Chungnam National' },
    { id: 'inst-cbnu',      name: '충북대학교',           shortName: 'Chungbuk National' },
    { id: 'inst-jbnu',      name: '전북대학교',           shortName: 'Jeonbuk National' },
    { id: 'inst-gnu',       name: '경상국립대학교',       shortName: 'Gyeongsang National' },
    { id: 'inst-kangwon',   name: '강원대학교',           shortName: 'Kangwon National' },
    { id: 'inst-jejunu',    name: '제주대학교',           shortName: 'Jeju National' },
    { id: 'inst-yeungnam',  name: '영남대학교',           shortName: 'Yeungnam' },
    { id: 'inst-donga',     name: '동아대학교',           shortName: 'Dong-A' },
    { id: 'inst-keimyung',  name: '계명대학교',           shortName: 'Keimyung' },
    { id: 'inst-ulsan',     name: '울산대학교',           shortName: 'Ulsan' },
    { id: 'inst-chosun',    name: '조선대학교',           shortName: 'Chosun' },
  ]

  const institutions = await Promise.all(
    institutionData.map((inst) =>
      prisma.institution.upsert({
        where: { name: inst.name },
        update: { shortName: inst.shortName },
        create: inst,
      })
    )
  )

  console.log(`✅ Created ${institutions.length} institutions`)

  // 각 학교에 모든 모듈 연결 (InstitutionModule)
  const moduleIds = [
    'module-01', 'module-02', 'module-03', 'module-04', 'module-05',
    'module-06', 'module-07', 'module-08', 'module-09', 'module-10',
  ]

  const moduleRequiredMap: Record<string, boolean> = {
    'module-01': true,
    'module-02': true,
    'module-03': true,
    'module-04': false,
    'module-05': true,
    'module-06': true,
    'module-07': true,
    'module-08': true,
    'module-09': false,
    'module-10': false,
  }

  let institutionModuleCount = 0

  for (const institution of institutions) {
    for (let i = 0; i < moduleIds.length; i++) {
      const moduleId = moduleIds[i]
      await prisma.institutionModule.upsert({
        where: {
          institutionId_moduleId: {
            institutionId: institution.id,
            moduleId,
          },
        },
        update: {},
        create: {
          institutionId: institution.id,
          moduleId,
          priority: i + 1,
          isRequired: moduleRequiredMap[moduleId] ?? false,
        },
      })
      institutionModuleCount++
    }
  }

  console.log(`✅ Created ${institutionModuleCount} institution-module links`)
  console.log('🎉 Seeding complete!')
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
